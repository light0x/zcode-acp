// zcode app-server 协议客户端：进程监管 + 行 JSON JSON-RPC（无封装）+ 服务端反向请求应答。
// 传输细节（实测，zcode 0.17.0）：
//   - 出站请求 {id, method, params}，响应 {id, result|error}（标准 JSON-RPC 错误码）；
//   - 服务端会反向发起请求（id 形如 server-N），必须应答，否则服务端 15s 超时并使原请求失败；
//   - 通知：startup/*、state.updated（投影补丁 + 模型目录）、session/event（需按会话订阅）、遥测类。
// 进程退出后 generation 递增；上层据此判断需要重新 attach（session/resume）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { LineRpc } from "./rpc.mjs";
import { resolveZcodeBin, zcodeCommand } from "./zcode-headless.mjs";
import { rotatingAppend } from "./logging.mjs";

const REQUEST_TIMEOUT_MS = 30000;

// 凭据库统一解密（AppServerClient 与 AppServerBridge 共用）：
// - v1：enc:v1:<iv>.<tag>.<data>，key=sha256(env secret 或历史 fallback 推导)；
// - v2：enc:v2:<source>:<keyHint>:<iv>.<tag>.<data>（实测自 zcode 3.18.2 zcode.cjs LTo/pvt/lEn），
//   keyHint=sha256(key).hex 前 24 位。env 来源 key=sha256(secret)，secret 取 ZCODE_CREDENTIAL_SECRET →
//   ZCODE_CREDENTIAL_SECRET_FILE → credentials.json 同目录 credential-secret 文件（600 权限、32~4096 字节）；
//   os 来源 key 即系统钥匙串条目的内容，由 osCredentialKey 异步读入后经 osKey 传入，未传入则不可解。
export function decryptCredential(value, credentialsFilePath, osKey = null) {
  if (typeof value !== "string" || !value) return null;
  if (!value.startsWith("enc:")) return value;
  if (value.startsWith("enc:v2:")) {
    return decryptCredentialV2(value.slice("enc:v2:".length), credentialsFilePath, osKey);
  }
  const PREFIX = "enc:v1:";
  if (!value.startsWith(PREFIX)) return null;
  const secret =
    process.env.ZCODE_CREDENTIAL_SECRET?.trim() ||
    `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${os.userInfo().username}`;
  const parts = value.slice(PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  try {
    const key = crypto.createHash("sha256").update(secret).digest();
    return aesGcmOpen(key, parts);
  } catch {
    return null;
  }
}

// os 来源的解密密钥存于系统钥匙串（逆向自 zcode 4.0.0 zcode.cjs）：条目 service 固定为
// "ZCode Credential Encryption"，user 为 credentials.json 绝对路径的 sha256 hex，值为 base64url(32 字节 key)。
// 经可选依赖 @napi-rs/keyring 读取；依赖缺失、平台不支持或条目不存在时解析为 null（仅 os 来源凭据不可解）。
// 命中结果按文件缓存，未命中不缓存——凭据库之后迁入钥匙串仍可重试。
const OS_KEYRING_SERVICE = "ZCode Credential Encryption";
const osKeyCache = new Map();

export function osCredentialKey(credentialsFilePath, log) {
  const file = path.resolve(credentialsFilePath);
  let pending = osKeyCache.get(file);
  if (!pending) {
    pending = import("@napi-rs/keyring")
      .then(({ AsyncEntry }) => {
        const user = crypto.createHash("sha256").update(file).digest("hex");
        return new AsyncEntry(OS_KEYRING_SERVICE, user, { linux: { store: "secret-service" } }).getPassword();
      })
      .then((stored) => {
        const key = Buffer.from(typeof stored === "string" ? stored : "", "base64url");
        return key.length === 32 ? key : null;
      })
      .catch((err) => {
        log?.(`credential keyring unavailable: ${err?.message ?? err}`);
        return null;
      });
    osKeyCache.set(file, pending);
    pending.then((key) => {
      if (!key) osKeyCache.delete(file);
    });
  }
  return pending;
}

// 凭据库是否含 os 来源的值——仅此时才需要（也才去）读取系统钥匙串
export function usesOsSource(credentialsFilePath) {
  try {
    return Object.values(JSON.parse(fs.readFileSync(credentialsFilePath, "utf8"))).some(
      (v) => typeof v === "string" && v.startsWith("enc:v2:os:"),
    );
  } catch {
    return false;
  }
}

function decryptCredentialV2(body, credentialsFilePath, osKey) {
  const h = body.split(":");
  if (h.length !== 3 || !h[0] || !h[1] || !h[2] || !["os", "env"].includes(h[0]) || !/^[a-f0-9]{24}$/.test(h[1])) return null;
  if (h[0] === "os") return openV2(osKey, h);
  if (process.env.ZCODE_CREDENTIAL_SECRET && process.env.ZCODE_CREDENTIAL_SECRET_FILE) return null;
  let secret = process.env.ZCODE_CREDENTIAL_SECRET?.trim();
  if (!secret && process.env.ZCODE_CREDENTIAL_SECRET_FILE) {
    try {
      secret = fs.readFileSync(process.env.ZCODE_CREDENTIAL_SECRET_FILE, "utf8");
    } catch {
      return null;
    }
  }
  if (!secret) {
    try {
      const dir = path.dirname(credentialsFilePath ?? path.join(os.homedir(), ".zcode", "v2", "credentials.json"));
      const file = path.join(dir, "credential-secret");
      const st = fs.statSync(file);
      if (!st.isFile() || (process.platform !== "win32" && st.mode & 0o777 !== 0o600)) return null;
      secret = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
  const bytes = Buffer.byteLength(secret, "utf8");
  if (!secret || bytes < 32 || bytes > 4096) return null;
  return openV2(crypto.createHash("sha256").update(secret).digest(), h);
}

// 以 key 打开 v2 载荷 [<source>, <keyHint>, <iv>.<tag>.<data>]；keyHint 不匹配（密钥已轮换）视为不可解
function openV2(key, [, keyHint, blob]) {
  if (!key?.length) return null;
  const hint = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
  if (hint !== keyHint) return null;
  try {
    return aesGcmOpen(key, blob.split("."));
  } catch {
    return null;
  }
}

function aesGcmOpen(key, parts) {
  if (parts.length !== 3) return null;
  const [iv, tag, data] = parts.map((s) => Buffer.from(s, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

// 编码套餐注入 provider 的模型清单。成员不是白名单：随内置目录的 builtinModelIds 走，账号通道的 modelOrder
// 只是排序偏好（排在前面），目录新增的模型（如 3.19.1 起的 GLM-5.4）自动出现；过滤只有黑名单 disabled。
export function codingPlanModelIds(modelOrder, builtinModelIds, disabled = []) {
  const out = [];
  const hidden = new Set(disabled);
  for (const id of [...(modelOrder ?? []), ...(builtinModelIds ?? [])]) {
    if (typeof id === "string" && id && !hidden.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// 账号通道被禁用的模型：内置目录的 builtinProviderModelRules 给出缺省，用户的 providerModelRules 覆盖，
// 两处都没有规则的模型默认启用。
export function disabledModelIds(builtinConfig, userConfig, providerId) {
  const enabled = new Map();
  for (const rules of [
    builtinConfig?.modelConfigRules?.builtinProviderModelRules,
    userConfig?.modelConfigRules?.providerModelRules,
  ]) {
    for (const r of rules ?? []) {
      if (r?.providerId === providerId && typeof r.config?.enabled === "boolean") enabled.set(r.modelId, r.config.enabled);
    }
  }
  return [...enabled].filter(([, on]) => !on).map(([id]) => id);
}

export class AppServerClient extends EventEmitter {
  // answer: async (method, params) => result 对象（interaction/requestPermission 等反向请求的应答）
  // protocolLog：非空时逐行记录 app-server 原始出入站流量（排障用）
  // injectedProviderConfig：注入副本的落盘路径（缺省 ~/.zcode/cli/zcode-acp-provider-config.json）
  constructor({ bin, cwd, log, answer, protocolLog, credentialsFile, injectedProviderConfig } = {}) {
    super();
    this.bin = bin ?? resolveZcodeBin();
    this.cwd = cwd;
    this.log = log ?? (() => {});
    this.answer = answer ?? (() => ({}));
    this.credentialsFile = credentialsFile;
    this.injectedProviderConfig = injectedProviderConfig;
    this.osKey = null; // os 来源凭据的钥匙串密钥（32 字节），启动 app-server 前按需读入
    this._osCredentialKey = osCredentialKey; // 可注入替身（测试）
    this.rpc = null; // 每次连接新建（见 _start）
    this.child = null;
    this.starting = null;
    this.gen = 0; // 连接代数：每崩一次 +1
    this.protocolLog = protocolLog ?? process.env.ZCODE_ACP_PROTOCOL_LOG ?? null;
  }

  _trace(direction, line) {
    if (!this.protocolLog) return;
    rotatingAppend(this.protocolLog, `${new Date().toISOString()} ${direction} ${line.slice(0, 2000)}`);
  }

  get generation() {
    return this.gen;
  }

  // app-server 启动硬性要求成对的内置/个人 provider 配置路径。桌面上下文会通过
  // ZCODE_*_PROVIDER_CONFIG_FILE 环境变量传入（子进程自动继承）；Zed 等独立环境没有，
  // 需在此探测注入，否则 app-server 以 code 1 退出。另外注入后端地址（缺失时
  // 运行时物化会失败，session/create 返回无 session 的降级结果）。
  _providerEnv() {
    const out = {};
    const personalFromEnv = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE ?? null;
    if (!(process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE && personalFromEnv)) {
      const builtin = this._locateBuiltinProviderConfig();
      if (builtin) {
        out.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtin;
        out.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = personalFromEnv
          ?? path.join(os.homedir(), ".zcode", "v2", "provider_config.json");
      } else {
        this.log(
          "app-server: builtin provider config not found; set ZCODE_BUILTIN_PROVIDER_CONFIG_FILE / ZCODE_PERSONAL_PROVIDER_CONFIG_FILE explicitly",
        );
      }
    }
    if (!process.env.ZCODE_BASE_URL) {
      out.ZCODE_BASE_URL = "https://zcode.z.ai";
      out.ZCODE_ENV = process.env.ZCODE_ENV ?? "production";
    }
    // 编码套餐注入：官方文档允许「启动器从受控凭据来源写入临时配置」（usage/03-config.md）。
    // 独立 app-server 的注册表不含账号通道的 provider，这里把套餐 key 以 personalModelIds
    // 形态写入临时个人配置副本，使 GLM 模型在任意上下文可选。
    const personalPath = out.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE ?? personalFromEnv;
    if (personalPath) {
      const injected = this._injectCodingPlanProvider(
        personalPath,
        out.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ?? process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE,
      );
      if (injected) out.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = injected;
    }
    return out;
  }

  // 内置目录的 config（zcode-builtin.json → config）；目录缺失或不可读时为空对象，
  // 注入退回仅按用户 modelOrder 列出模型
  _builtinProviderConfig(builtinPath) {
    try {
      const config = JSON.parse(fs.readFileSync(builtinPath, "utf8")).config;
      return config && typeof config === "object" ? config : {};
    } catch {
      return {};
    }
  }

  // 读取用户个人配置，合并编码套餐 provider（凭据库解密出套餐 api-key），
  // 写入适配器拥有的副本文件；失败时回退用户原配置。返回副本路径或 null。
  _injectCodingPlanProvider(personalPath, builtinPath) {
    try {
      const source = JSON.parse(fs.readFileSync(personalPath, "utf8"));
      const keys = this._codingPlanApiKeys();
      if (!Object.keys(keys).length) {
        this.log("coding-plan: 凭据库无可用套餐 api-key（未登录或 secret 不可解，运行 zcode login 后重启会话）");
        return null;
      }
      source.config ??= {};
      source.config.providerConfigRules ??= {};
      const rules = (source.config.providerConfigRules.providerRules ??= []);
      const builtin = this._builtinProviderConfig(builtinPath);
      const families = new Map(); // base id → { key, modelIds }
      for (const [credKey, credValue] of Object.entries(keys)) {
        const m = credKey.match(/^account-provider:coding-plan:account:([^:]+):account:\d+:api-key$/);
        if (!m) continue;
        const base = m[1].replace(/^account:/, "");
        const providerId = `${base.split("-")[0]}-coding-plan`;
        const accountId = `account:${m[1]}`;
        const accountEntry = rules.find((r) => r.providerId === accountId);
        const builtinEntry = builtin.providerConfigRules?.providerRules?.find((r) => r.providerId === accountId);
        families.set(providerId, {
          apiKey: credValue,
          modelIds: codingPlanModelIds(
            accountEntry?.config?.modelOrder,
            builtinEntry?.config?.builtinModelIds,
            disabledModelIds(builtin, source.config, accountId),
          ),
        });
      }
      if (!families.size) return null;
      let changed = false;
      for (const [providerId, { apiKey, modelIds }] of families) {
        const existing = rules.find(
          (r) => r.providerId === providerId && r.config?.access?.type === "api-key",
        );
        if (existing) {
          if (existing.config?.access?.apiKey !== apiKey) {
            existing.config.access.apiKey = apiKey;
            changed = true;
          }
          continue;
        }
        const family = providerId.split("-")[0];
        const endpoints = {
          bigmodel: { type: "anthropic-messages", baseUrl: "https://open.bigmodel.cn/api/anthropic" },
          zai: { type: "anthropic-messages", baseUrl: "https://api.z.ai/api/anthropic" },
        };
        rules.push({
          providerId,
          providerName: "GLM Coding Plan",
          enabled: true,
          config: {
            group: "standard-personal",
            access: { type: "api-key", apiKey },
            api: endpoints[family] ?? { type: "openai-chat-completions" },
            ...(modelIds.length ? { personalModelIds: modelIds } : {}),
          },
        });
        changed = true;
      }
      if (source.config?.providerOrder && !changed) {
        // 已有同名 provider 且 key 未变化：仍需副本文件（含该 provider）供 app-server 使用
      }
      const order = source.config?.providerOrder;
      if (Array.isArray(order) && !order.some((id) => families.has(id))) {
        order.push(...families.keys());
        changed = true;
      }
      const outFile =
        this.injectedProviderConfig ?? path.join(os.homedir(), ".zcode", "cli", "zcode-acp-provider-config.json");
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(source, null, 1));
      return outFile;
    } catch (err) {
      this.log(`provider config injection failed: ${err?.message ?? err}`);
      return null;
    }
  }

  // 凭据库中编码套餐 api-key 条目（键 → 解密后的明文 key）
  _credentialsPath() {
    return this.credentialsFile ?? this._credentialsFile?.() ?? path.join(os.homedir(), ".zcode", "v2", "credentials.json");
  }

  _codingPlanApiKeys() {
    const file = this._credentialsPath();
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!/^account-provider:coding-plan:account:[^:]+:account:\d+:api-key$/.test(k)) continue;
      const plain = this._decryptCredential(typeof v === "string" ? v : "");
      if (typeof plain === "string" && plain) out[k] = plain;
    }
    return out;
  }

  // 凭据解密：v1 与 v2 统一走 decryptCredential（见模块头），os 来源带上已读入的钥匙串密钥
  _decryptCredential(value) {
    return decryptCredential(value, this._credentialsPath(), this.osKey);
  }

  // 凭据库含 os 来源的值时读取系统钥匙串密钥，否则不触碰钥匙串
  async _loadOsKey() {
    const file = this._credentialsPath();
    this.osKey = usesOsSource(file) ? await this._osCredentialKey(file, this.log) : null;
  }

  // 内置配置解析顺序：桌面运行期物化副本（取最新）→ 安装包内静态副本
  _locateBuiltinProviderConfig(runtimeRoot = path.join(os.homedir(), ".zcode", "v2", "runtime", "provider")) {
    const found = [];
    const scan = (dir, depth) => {
      if (depth > 3) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) scan(p, depth + 1);
        else if (e.name === "zcode-builtin.json") {
          try {
            found.push({ p, m: fs.statSync(p).mtimeMs });
          } catch {}
        }
      }
    };
    scan(runtimeRoot, 0);
    if (found.length) {
      found.sort((a, b) => b.m - a.m);
      return found[0].p;
    }
    const binDir = path.dirname(this.bin);
    for (const c of [
      path.join(binDir, "provider", "zcode-builtin.json"),
      path.join(binDir, "..", "config", "provider", "zcode-builtin.json"),
      path.join(binDir, "..", "provider", "zcode-builtin.json"),
    ]) {
      try {
        if (fs.existsSync(c)) return c;
      } catch {}
    }
    return null;
  }

  // 幂等启动；ready 以首批 startup 通知或短暂延时为准（协议无显式 ready 帧）
  async ensure() {
    if (this.child && this.child.exitCode === null) return;
    if (this.starting) return this.starting;
    this.starting = this._start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async _start() {
    const { command, baseArgs } = zcodeCommand(this.bin);
    await this._loadOsKey();
    const child = spawn(command, [...baseArgs, "app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", ...this._providerEnv() },
      ...(this.cwd ? { cwd: this.cwd } : {}),
    });
    this.child = child;
    // 每次重启新建 rpc：旧实例的 pending 随连接死亡，attach 状态不可复用
    const rpc = new LineRpc({ withJsonRpc: false });
    this.rpc = rpc;
    rpc.attach(child.stdout, child.stdin);
    const origWrite = rpc.write.bind(rpc);
    rpc.write = (obj) => {
      this._trace("C->S", JSON.stringify(obj));
      return origWrite(obj);
    };
    rpc.on("parse-error", (line) => this._trace("S->S?", line));
    rpc.on("notification", (msg) => {
      this._trace("S->C", JSON.stringify(msg).slice(0, 2000));
      this.emit("notification", msg);
    });
    rpc.on("request", (msg) => {
      this._trace("S->C-req", JSON.stringify(msg).slice(0, 1000));
      Promise.resolve(this.answer(msg.method, msg.params))
        .then((result) => rpc.respond(msg.id, result ?? {}))
        .catch((err) => {
          this.log(`app-server: answer ${msg.method} failed: ${err?.message ?? err}`);
          rpc.respond(msg.id, {});
        });
    });
    child.stderr.on("data", (d) => {
      const s = d.toString().trim();
      if (s && !s.includes("ExperimentalWarning")) this.log(`app-server stderr: ${s.slice(0, 300)}`);
    });
    child.on("error", (err) => {
      this.log(`app-server spawn failed: ${err?.message ?? err}`);
      // spawn 失败没有 exit 事件，挂起请求立即失败以暴露真实原因
      for (const [, w] of rpc.pending) {
        try {
          w.reject({ code: -32603, message: `app-server spawn failed: ${err?.message ?? err}` });
        } catch {}
      }
      rpc.pending.clear();
    });
    child.on("exit", (code) => {
      this.gen += 1;
      this.child = null;
      // 挂起请求立即失败并带真实原因，避免等满超时还看不出端倪
      for (const [, w] of rpc.pending) {
        try {
          w.reject({ code: -32603, message: `app-server exited (code ${code ?? "signal"}) while request pending` });
        } catch {}
      }
      rpc.pending.clear();
      this.emit("exit", code);
    });
    // 首条输出或 1.5s 视为就绪
    await new Promise((resolve) => {
      const timer = setTimeout(done, 1500);
      const onFirst = () => done();
      this.once("notification", onFirst);
      function done() {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  async request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    await this.ensure();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error(`app-server request timeout: ${method}`)), { id: null }), timeoutMs);
      const id = this.rpc.nextId++;
      this.rpc.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(Object.assign(new Error(err?.message ?? `app-server error: ${method}`), { code: err?.code, data: err?.data }));
        },
      });
      this.rpc.write({ id, method, params: params ?? {} });
    });
  }

  kill() {
    this.child?.kill();
  }
}
