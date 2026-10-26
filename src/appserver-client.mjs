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

export class AppServerClient extends EventEmitter {
  // answer: async (method, params) => result 对象（interaction/requestPermission 等反向请求的应答）
  // protocolLog：非空时逐行记录 app-server 原始出入站流量（排障用）
  constructor({ bin, cwd, log, answer, protocolLog } = {}) {
    super();
    this.bin = bin ?? resolveZcodeBin();
    this.cwd = cwd;
    this.log = log ?? (() => {});
    this.answer = answer ?? (() => ({}));
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
      const injected = this._injectCodingPlanProvider(personalPath);
      if (injected) out.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = injected;
    }
    return out;
  }

  // 读取用户个人配置，合并编码套餐 provider（凭据库解密出套餐 api-key），
  // 写入适配器拥有的副本文件；失败时回退用户原配置。返回副本路径或 null。
  _injectCodingPlanProvider(personalPath) {
    try {
      const source = JSON.parse(fs.readFileSync(personalPath, "utf8"));
      const keys = this._codingPlanApiKeys();
      if (!Object.keys(keys).length) return null;
      source.config ??= {};
      source.config.providerConfigRules ??= {};
      const rules = (source.config.providerConfigRules.providerRules ??= []);
      const families = new Map(); // base id → { key, modelOrder? }
      for (const [credKey, credValue] of Object.entries(keys)) {
        const m = credKey.match(/^account-provider:coding-plan:account:([^:]+):account:\d+:api-key$/);
        if (!m) continue;
        const base = m[1].replace(/^account:/, "");
        const providerId = `${base.split("-")[0]}-coding-plan`;
        const accountEntry = rules.find((r) => r.providerId === `account:${m[1]}`);
        families.set(providerId, {
          apiKey: credValue,
          modelOrder: accountEntry?.config?.modelOrder ?? [],
        });
      }
      if (!families.size) return null;
      let changed = false;
      for (const [providerId, { apiKey, modelOrder }] of families) {
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
            ...(modelOrder.length ? { personalModelIds: modelOrder } : {}),
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
      const outFile = path.join(os.homedir(), ".zcode", "cli", "zcode-acp-provider-config.json");
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify(source, null, 1));
      return outFile;
    } catch (err) {
      this.log(`provider config injection failed: ${err?.message ?? err}`);
      return null;
    }
  }

  // 凭据库中编码套餐 api-key 条目（键 → 解密后的明文 key）
  _codingPlanApiKeys() {
    const file = this._credentialsFile?.() ?? path.join(os.homedir(), ".zcode", "v2", "credentials.json");
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

  _decryptCredential(value) {
    const PREFIX = "enc:v1:";
    if (!value.startsWith(PREFIX)) return value;
    const secret =
      process.env.ZCODE_CREDENTIAL_SECRET?.trim() ||
      `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${os.userInfo().username}`;
    const parts = value.slice(PREFIX.length).split(".");
    if (parts.length !== 3) return null;
    try {
      const key = crypto.createHash("sha256").update(secret).digest();
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64url"));
      d.setAuthTag(Buffer.from(parts[1], "base64url"));
      return Buffer.concat([d.update(Buffer.from(parts[2], "base64url")), d.final()]).toString();
    } catch {
      return null;
    }
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
