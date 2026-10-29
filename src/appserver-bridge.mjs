// app-server 桥接：常驻 zcode app-server 子进程，会话方法直通协议，
// session/event 事件流翻译为 ACP 更新（流式分块、工具状态、usage、turn 收束）。
// 对外接口与无头桥接一致：createNew/prompt/cancel/resume/list/close/setConfigOption。
// 会话 ID 即 zcode 原生 sess_* ID（session/create 立即返回，无需本地映射）。
// 模型与思考强度以 config options 暴露（zcode.model / zcode.reasoning），
// 目录来自 state.updated 推送的 model.available。
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAvailableCommands, splitPromptBlocks, extForMime, toolNameToKind, deriveToolTitle, deriveToolLocations, toolResultText, toolResultDiffBlocks, MODE_PRESENTATION } from "./content.mjs";
import {
  listSessions,
  readHistory,
  listCliCommands,
  listCliSkills,
  getSessionModelSelection,
  resolveZcodeBin,
} from "./zcode-headless.mjs";
import { AppServerClient } from "./appserver-client.mjs";

const MODE_VALUES = ["plan", "build", "edit", "yolo", "guarded"];
const CATALOG_WAIT_MS = 4000;

function uuid() {
  return crypto.randomUUID();
}

export class AppServerBridge {
  // deps: { sendUpdate(sessionId, update), log(...args), onPermissionRequest(req) => "allow"|"deny", client }
  constructor(deps = {}) {
    this.sendUpdate = deps.sendUpdate ?? (() => {});
    this.log = deps.log ?? (() => {});
    // 思考流显示的会话默认值：ZCODE_ACP_THINKING_DISPLAY=full 打开（缺省精简），面板开关可按会话覆盖
    const envDisplay = process.env.ZCODE_ACP_THINKING_DISPLAY;
    this.thinkingDisplayDefault = envDisplay === "full" ? "full" : "concise";
    if (envDisplay && envDisplay !== "full" && envDisplay !== "concise") {
      this.log(`invalid ZCODE_ACP_THINKING_DISPLAY=${envDisplay}; using concise`);
    }
    this.onPermissionRequest = deps.onPermissionRequest;
    this.onElicitation = deps.onElicitation;
    this.bin = resolveZcodeBin(deps.bin);
    // 凭据文件（与 zcode 共享，只读）；缺省随个人 provider 配置所在目录
    this.credentialsPath =
      deps.credentialsPath ?? path.join(os.homedir(), ".zcode", "v2", "credentials.json");
    this._credentialsCache = null; // { at, map }
    this._listSessions = listSessions;
    this._readHistory = readHistory;
    this._getModelSelection = getSessionModelSelection;
    this._listCliCommands = listCliCommands;
    this._listCliSkills = listCliSkills;
    // client 可注入替身（测试）；注入对象需实现 ensure/request/on/kill/generation
    this.client =
      deps.client ??
      new AppServerClient({
        bin: this.bin,
        log: this.log,
        protocolLog: deps.protocolLog,
        answer: (method, params) => this._answerServer(method, params),
      });
    this.client.on("notification", (msg) => this._onNotification(msg).catch((e) => this.log(`notification error: ${e?.message ?? e}`)));
    this.sessions = new Map(); // zcode sess_* ID -> 会话状态
    this.catalog = null; // 最近一次 state.updated 的 model.available
  }

  // ---------- ACP 方法 ----------

  async createNew({ cwd, mode }) {
    const client = await this._client();
    // 冷启动（杀软扫描、插件 MCP 装配）可能拖慢首个 create；放宽超时并重试一次
    const create = () =>
      client.request(
        "session/create",
        { workspace: { workspacePath: cwd, workspaceKey: cwd } },
        120000,
      );
    let r;
    try {
      r = await create();
    } catch (err) {
      this.log(`session/create failed, retrying once: ${err?.message ?? err}`);
      r = await create();
    }
    const zid = r?.session?.sessionId;
    if (!zid) throw Object.assign(new Error(`session/create returned no sessionId: ${JSON.stringify(r).slice(0, 200)}`), { code: -32603 });
    const st = this._state(zid);
    st.cwd = cwd;
    st.gen = client.generation;
    st.contextWindow = r?.projection?.contextWindow;
    if (r?.session?.model) this._adoptModel(st, r.session.model);
    // 全量模型目录以 create 结果的 settings 快照为准（state 补丁只含当前 provider 的模型集）
    if (Array.isArray(r?.settings?.model?.available) && r.settings.model.available.length) {
      this.catalog = this._mergeCatalog(this.catalog, r.settings.model.available);
    }
    // 初始 todo 清单 → ACP plan（turn 结束后经 session/read 增量同步）
    if (Array.isArray(r?.todos)) {
      this._state(zid).lastTodos = this._todoEntries(r.todos);
      this._emitPlan(zid, r.todos);
    }
    if (mode && MODE_VALUES.includes(mode)) st.mode = mode;    // 默认 yolo（与无头桥接行为一致）；会话默认为 build 时切过去
    if (st.mode !== (r?.session?.mode ?? "build")) {
      await client.request("session/setMode", { sessionId: zid, mode: st.mode });
    }
    await client.request("session/subscribe", { sessionId: zid, deliveryKind: "desktop-continuous" });
    await this._refreshCatalog();
    const availableCommands = await this._availableCommands(cwd);
    // 服务端声明的 slashCommands（goal/compact/init…）是权威命令表，优先合并
    st.serverSlashCommands = Array.isArray(r?.slashCommands) ? r.slashCommands : [];
    const mergedCommands = this._finalCommands(st, availableCommands);
    st.lastCommands = JSON.stringify(mergedCommands);
    return {
      sessionId: zid,
      configOptions: this._configOptions(st),
      availableCommands: mergedCommands,
    };
  }

  async prompt({ sessionId, blocks }) {
    const st = this._state(sessionId);
    if (st.closed) throw Object.assign(new Error("session is closed"), { code: -32602 });
    if (!st.cwd) throw Object.assign(new Error("unknown session"), { code: -32602 });
    const { text, media, files, links } = splitPromptBlocks(blocks);
    await this._attach(st);
    const messageId = `msg_user_${++st.userN}_${uuid().slice(0, 8)}`;
    this._update(sessionId, {
      sessionUpdate: "user_message",
      messageId,
      content: [
        { type: "text", text },
        ...links,
        ...media.map((m) => ({ type: m.mimeType.startsWith("audio/") ? "audio" : "image", data: m.data, mimeType: m.mimeType })),
      ],
    });
    // @ 提及的本地文件直挂 localPath（zcode 附件的 file kind），媒体仍走分块上传
    const attachments = [
      ...(media.length ? await this._uploadAttachments(sessionId, media) : []),
      ...files.map((f) => ({ kind: "file", filename: f.name, mimeType: f.mimeType, sizeBytes: f.size, localPath: f.path })),
    ];
    // send 受理后才返回（错误 = 消息未插入）；turn 由 _drain 串行执行
    await new Promise((resolve, reject) => {
      st.queue.push({ text, attachments, messageId, resolve, reject });
      this._drain(sessionId);
    });
    return { messageId };
  }

  _drain(sessionId) {
    const st = this._state(sessionId);
    if (st.turn) return;
    const next = st.queue.shift();
    if (!next) return;
    st.turn = {
      startedAt: Date.now(),
      agentN: 0,
      textLen: 0,
      cancelRequested: false,
      tools: new Map(), // toolCallId -> status
    };
    st.toolInputs?.clear(); // 流式工具输入按轮清理，防跨轮累积
    st.agentMsgId = `msg_agent_${++st.lastAgentN}_${uuid().slice(0, 8)}`;
    st.thoughtMsgId = `msg_thought_${st.lastAgentN}_${uuid().slice(0, 8)}`;
    this._update(sessionId, { sessionUpdate: "state_update", state: "running" });
    this._client()
      .then((client) =>
        client.request("session/send", {
          sessionId,
          content: next.text,
          ...(next.attachments?.length ? { attachments: next.attachments } : {}),
        }),
      )
      .then(() => next.resolve())
      .catch((err) => {
        this.log(`session/send failed: ${err?.message ?? err}`);
        next.reject(Object.assign(new Error(err?.message ?? "send failed"), { code: err?.code ?? -32603 }));
        this._endTurn(sessionId, { stopReason: "error", error: { code: err?.code ?? -32603, message: err?.message ?? "send failed" } });
      });
  }

  // 图片经官方分块上传协议入库：v4/attachment/begin → chunk(512KB) → commit，
  // 返回 session/send 的 attachments 条目（{ref, fileName, mime, bytes}）
  async _uploadAttachments(sessionId, media) {
    const client = await this._client();
    const out = [];
    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      const data = Buffer.from(item.data, "base64");
      const connectionId = `zcode-acp-${uuid().slice(0, 8)}`;
      const uploadId = `att-${i}-${uuid().slice(0, 8)}`;
      const kind = item.mimeType.startsWith("audio/") ? "audio" : "image";
      const ext = extForMime(item.mimeType);
      const fileName = `${kind}-${i + 1}.${ext}`;
      const chunkMax = 512 * 1024;
      const totalChunks = Math.max(1, Math.ceil(data.length / chunkMax));
      await client.request("v4/attachment/begin", {
        connectionId,
        uploadId,
        sessionId,
        fileName,
        mime: item.mimeType,
        totalBytes: data.length,
        totalChunks,
        checksum: `sha256:${crypto.createHash("sha256").update(data).digest("hex")}`,
      });
      for (let c = 0; c < totalChunks; c++) {
        await client.request("v4/attachment/chunk", {
          connectionId,
          uploadId,
          sessionId,
          chunkIndex: c,
          dataBase64: data.subarray(c * chunkMax, (c + 1) * chunkMax).toString("base64"),
        });
      }
      const commit = await client.request("v4/attachment/commit", { connectionId, uploadId, sessionId });
      const ref = commit?.ref;
      if (!ref) throw Object.assign(new Error(`attachment commit returned no ref`), { code: -32603 });
      out.push({ ref, fileName, mime: item.mimeType, bytes: data.length });
    }
    return out;
  }

  async cancel(sessionId) {
    const st = this._state(sessionId);
    st.queue.length = 0;
    if (!st.turn) return {};
    st.turn.cancelRequested = true;
    try {
      const client = await this._client();
      await client.request("session/stop", { sessionId });
    } catch (err) {
      this.log(`session/stop failed: ${err?.message ?? err}`);
    }
    await this._waitTurnEnd(st, 8000);
    return {};
  }

  async resume({ sessionId, cwd, replayFrom }) {
    if (replayFrom !== undefined && replayFrom !== null && replayFrom?.type !== "start") {
      throw Object.assign(new Error(`unsupported replayFrom type: ${replayFrom?.type}`), { code: -32602 });
    }
    await this._client();
    const st = this._state(sessionId);
    st.closed = false;
    if (cwd) st.cwd = cwd;
    st.zcodeId = sessionId;
    // _attach：session/resume 重挂 + 订阅事件流（gen 守卫去重）
    await this._attach(st);
    await this._refreshCatalog();
    if (replayFrom?.type === "start") await this._replayFromStore(sessionId);
    this._update(sessionId, { sessionUpdate: "state_update", state: "idle" });
    const availableCommands = await this._availableCommands(st.cwd);
    const mergedCommands = this._finalCommands(st, availableCommands);
    st.lastCommands = JSON.stringify(mergedCommands);
    return {
      configOptions: this._configOptions(st),
      availableCommands: mergedCommands,
    };
  }

  async list({ cwd }) {    if (!cwd) return { sessions: [] };
    const sessions = await this._listSessions(cwd);
    return { sessions };
  }

  async close(sessionId) {
    const st = this._state(sessionId);
    if (st.turn) await this.cancel(sessionId);
    try {
      const client = await this._client();
      await client.request("session/close", { sessionId });
    } catch (err) {
      this.log(`session/close failed: ${err?.message ?? err}`);
    }
    st.closed = true;
    this.sessions.delete(sessionId);
    return {};
  }

  async setConfigOption({ sessionId, configId, value }) {
    const st = this._state(sessionId);
    const v = value?.value ?? value;
    await this._attach(st);
    if (configId === "zcode.mode") {
      if (!MODE_VALUES.includes(v)) {
        throw Object.assign(new Error(`invalid mode: ${v}`), { code: -32602 });
      }
      const client = await this._client();
      await client.request("session/setMode", { sessionId, mode: v });
      st.mode = v;
      await this._refreshCommands(sessionId);
    } else if (configId === "zcode.model") {
      const entry = this._catalogEntry(v);
      if (!entry) throw Object.assign(new Error(`unknown model: ${v}`), { code: -32602 });
      const providerId = entry.ref.providerId;
      const modelId = entry.ref.modelId;
      const levels = entry.reasoning?.levels ?? [];
      const reasoning = levels.some((l) => l.value === st.reasoning)
        ? st.reasoning
        : entry.reasoning?.defaultLevel;
      const client = await this._client();
      await client.request("session/setModel", {
        sessionId,
        model: { providerId, modelId, ...(reasoning ? { options: { reasoningLevel: reasoning } } : {}) },
      });
      st.model = { providerId, modelId };
      if (reasoning) st.reasoning = reasoning;
      if (typeof entry.contextWindow === "number") st.contextWindow = entry.contextWindow;
    } else if (configId === "zcode.reasoning") {
      const entry = this._currentCatalogEntry(st);
      const levels = entry?.reasoning?.levels ?? [];
      if (levels.length && !levels.some((l) => l.value === v)) {
        throw Object.assign(new Error(`invalid reasoning level: ${v}`), { code: -32602 });
      }
      const client = await this._client();
      await client.request("session/setModel", {
        sessionId,
        model: {
          providerId: st.model.providerId,
          modelId: st.model.modelId,
          options: { reasoningLevel: v },
        },
      });
      st.reasoning = v;
    } else if (configId === "zcode.thinking_display") {
      if (v !== "concise" && v !== "full") {
        throw Object.assign(new Error(`invalid thinking display: ${v}`), { code: -32602 });
      }
      st.thinkingDisplay = v;
    } else {
      throw Object.assign(new Error(`unknown config option: ${configId}`), { code: -32602 });
    }
    return { configOptions: this._configOptions(st) };
  }

  // ---------- 会话内辅助 ----------

  async _client() {
    await this.client.ensure();
    return this.client;
  }

  // 预热：适配器启动即拉起 app-server，冷启动开销与 Zed 的首次 session/new 错峰
  warmup() {
    this._client().catch((err) => this.log(`app-server warmup failed: ${err?.message ?? err}`));
  }

  // 连接换代（app-server 崩溃重启）后重新挂接会话；resume 响应与 create 同形，
  // 无 create 上下文（新进程接管旧会话）时靠它重建模型目录与会话状态
  async _attach(st) {
    if (!st.zcodeId) st.zcodeId = st.sessionId;
    if (st.gen === this.client.generation && this.client.child) return;
    const client = await this._client();
    const r = await client.request("session/resume", {
      sessionId: st.sessionId,
      ...(st.cwd ? { workspace: { workspacePath: st.cwd, workspaceKey: st.cwd } } : {}),
    });
    if (r?.session?.model) this._adoptModel(st, r.session.model);
    // resume 响应的 session.model 不带思考档位，从会话存储的 model_selection 补齐
    const selection = await this._getModelSelection(st.sessionId);
    if (selection) this._adoptModel(st, selection);
    if (Array.isArray(r?.settings?.model?.available) && r.settings.model.available.length) {
      this.catalog = this._mergeCatalog(this.catalog, r.settings.model.available);
    }
    if (r?.session?.mode && MODE_VALUES.includes(r.session.mode)) st.mode = r.session.mode;
    if (Array.isArray(r?.slashCommands) && r.slashCommands.length) st.serverSlashCommands = r.slashCommands;
    await client.request("session/subscribe", { sessionId: st.sessionId, deliveryKind: "desktop-continuous" });
    st.gen = client.generation;
  }

  _state(sessionId) {
    let st = this.sessions.get(sessionId);
    if (!st) {
      st = {
        sessionId,
        cwd: null,
        mode: "yolo",
        model: null, // { providerId, modelId }
        reasoning: null,
        thinkingDisplay: this.thinkingDisplayDefault, // 思考流出线开关：concise 隐藏 / full 实时显示（适配器本地，不触及协议）
        contextWindow: null,
        zcodeId: sessionId,
        gen: -1,
        queue: [],
        turn: null,
        userN: 0,
        lastAgentN: 0,
        closed: false,
        turnWaiters: [],
        serverSlashCommands: [], // create/resume 时由服务端声明填充
        lastCommands: null,
      };
      this.sessions.set(sessionId, st);
    }
    return st;
  }

  _update(sessionId, update) {
    this.sendUpdate(sessionId, update);
  }

  async _waitTurnEnd(st, timeoutMs) {
    if (!st.turn) return;
    await new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      st.turnWaiters.push(done);
      function done() {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  _endTurn(sessionId, { stopReason = "end_turn", response, usage, error } = {}) {
    const st = this._state(sessionId);
    if (!st.turn) return;
    const turn = st.turn;
    st.turn = null;
    for (const w of st.turnWaiters.splice(0)) w();
    if (usage?.totalTokens !== undefined) {
      this._update(sessionId, {
        sessionUpdate: "usage_update",
        used: usage.totalTokens,
        ...(typeof st.contextWindow === "number" ? { size: st.contextWindow } : {}),
      });
    }
    // 流式未送达任何文本时（异常路径），用 turn.completed 的整段回复兜底
    if (response && !turn.textLen) {
      this._update(sessionId, {
        sessionUpdate: "agent_message",
        messageId: st.agentMsgId,
        content: [{ type: "text", text: response }],
      });
    }
    this._update(sessionId, {
      sessionUpdate: "state_update",
      state: "idle",
      stopReason,
      ...(error ? { error } : {}),
    });
    this._syncTodos(sessionId);
    this._refreshCommands(sessionId);
    this._drain(sessionId);
  }

  // 重算斜杠命令表，变化时以 available_commands_update 全量替换（v1 方言层负责形状翻译）
  async _refreshCommands(sessionId) {
    const st = this._state(sessionId);
    if (!st.cwd) return;
    try {
      const commands = this._finalCommands(st, await this._availableCommands(st.cwd));
      const key = JSON.stringify(commands);
      if (key === st.lastCommands) return;
      st.lastCommands = key;
      this._update(sessionId, {
        sessionUpdate: "available_commands_update",
        availableCommands: commands,
      });
    } catch (err) {
      this.log(`refresh commands failed: ${err?.message ?? err}`);
    }
  }

  // 最终命令表 = 服务端声明的 slashCommands（权威，含 goal/init 等）在前 + 桥接基线
  // （/skill 等，去重）在后
  _finalCommands(st, baseCommands) {
    const merged = new Map();
    for (const c of st.serverSlashCommands ?? []) {
      if (!c?.name) continue;
      merged.set(c.name, {
        name: c.name,
        description: c.description ?? "",
        ...(c.inputHint ? { input: { type: "text", hint: c.inputHint } } : {}),
      });
    }
    for (const c of baseCommands ?? []) {
      if (!merged.has(c.name)) merged.set(c.name, c);
    }
    return [...merged.values()];
  }

  // turn 结束后拉取最新 todo 清单，变化时发 plan 更新（v1 方言层翻译为 plan）
  _syncTodos(sessionId) {
    this._client()
      .then((client) => client.request("session/read", { sessionId }))
      .then((r) => {
        const todos = r?.todos;
        if (!Array.isArray(todos)) return;
        const st = this.sessions.get(sessionId);
        if (!st) return;
        const entries = this._todoEntries(todos);
        const next = JSON.stringify(entries);
        if (next === st.lastTodos) return;
        st.lastTodos = next;
        this._emitPlan(sessionId, todos);
      })
      .catch(() => {});
  }

  // zcode todo 条目 → ACP plan entry（字段宽容映射，状态收敛到三态）
  _todoEntries(todos) {
    return (todos ?? [])
      .map((t) => {
        const content = [t?.content, t?.text, t?.title, t?.label].find((v) => typeof v === "string" && v);
        if (!content) return null;
        const raw = String(t?.status ?? "pending").toLowerCase();
        const status =
          raw === "completed" || raw === "done"
            ? "completed"
            : raw === "in_progress" || raw === "inprogress" || raw === "running"
              ? "in_progress"
              : "pending";
        const priority = ["high", "medium", "low"].includes(t?.priority) ? t.priority : undefined;
        return { content, status, ...(priority ? { priority } : {}) };
      })
      .filter(Boolean);
  }

  _emitPlan(sessionId, todos) {
    const entries = this._todoEntries(todos);
    if (!entries.length) return;
    this._update(sessionId, {
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "zcode-todos", entries },
    });
  }

  // ---------- 协议事件 → ACP 更新 ----------

  async _onNotification(msg) {
    if (msg.method === "state.updated") {
      const p = msg.params ?? {};
      if (p.patch?.model?.available) this.catalog = this._mergeCatalog(this.catalog, p.patch.model.available);
      if (p.patch?.model?.current) {
        const st = this.sessions.get(p.sessionId);
        if (st) this._adoptModel(st, p.patch.model.current);
      }
      const st = p.sessionId ? this.sessions.get(p.sessionId) : null;
      if (st?.turn && p.patch?.status === "idle" && Date.now() - st.turn.startedAt > 1500) {
        // 兜底：个别路径没有 turn.completed，只有状态回落；避开 send 刚受理时的残留 idle 补丁
        this._endTurn(p.sessionId, { stopReason: st.turn.cancelRequested ? "cancelled" : "end_turn" });
      }
      return;
    }
    if (msg.method !== "session/event") return;
    const ev = msg.params ?? {};
    const st = this.sessions.get(ev.sessionId);
    if (!st || !st.turn) return;
    const kind = ev.type ?? ev.kind ?? "?";
    const payload = ev.payload ?? {};
    if (kind === "model.streaming") return this._onStreaming(st, payload);
    if (kind === "tool.updated") return this._onTool(st, payload);
    if (kind === "turn.completed") {
      const cancelled = st.turn.cancelRequested || payload.status === "cancelled";
      this._endTurn(st.sessionId, {
        stopReason: cancelled ? "cancelled" : mapStopReason(payload.status),
        response: payload.response,
        usage: payload.usage,
        ...(payload.status && payload.status !== "success" && !cancelled
          ? { error: { code: -32603, message: `turn ${payload.status}` } }
          : {}),
      });
      return;
    }
    if (/cancel|abort/.test(kind)) {
      this._endTurn(st.sessionId, { stopReason: "cancelled" });
      return;
    }
    if (/fail|error/.test(kind)) {
      this._endTurn(st.sessionId, {
        stopReason: "error",
        error: { code: -32603, message: payload.error ?? payload.reason ?? `turn ${kind}` },
      });
    }
  }

  _onStreaming(st, payload) {
    const kind = payload.kind;
    // tool_call 事件携带完整输入。app-server 对已流出的输入会在 tool.updated 上剥离
    // input（inputOmitted/inputRef=model_stream），不留档则客户端只见工具名不见命令。
    if (kind === "tool_call" && payload.toolCallId && payload.input !== undefined) {
      st.toolInputs ??= new Map();
      st.toolInputs.set(payload.toolCallId, payload.input);
      return;
    }
    const delta = payload.delta ?? "";
    if (!delta) return;
    if (kind === "reasoning_delta") {
      if (st.thinkingDisplay !== "full") return; // 精简模式默认：思考流不出线
      this._update(st.sessionId, {
        sessionUpdate: "agent_thought_chunk",
        messageId: st.thoughtMsgId,
        content: { type: "text", text: delta },
      });
    } else if (kind === "text_delta") {
      st.turn.textLen += delta.length;
      this._update(st.sessionId, {
        sessionUpdate: "agent_message_chunk",
        messageId: st.agentMsgId,
        content: { type: "text", text: delta },
      });
    }
    // tool_input_delta 不出线：增量只是原始 JSON 分片，完整输入已由 tool_call 事件送达
  }

  _onTool(st, payload) {
    const kind = payload.kind;
    const ids = payload.toolCallIds ?? (payload.toolCallId ? [payload.toolCallId] : []);
    for (const toolCallId of ids) {
      const known = st.turn.tools.get(toolCallId);
      let status;
      if (kind === "scheduled") status = "pending";
      else if (kind === "started" || kind === "running") status = "in_progress";
      else if (kind === "completed" || kind === "succeeded" || kind === "result" || kind === "batch") {
        if (known === "completed" || known === "failed") continue;
        status = payload.kind === "batch" && payload.errorCount ? "failed" : "completed";
      } else if (kind === "failed" || kind === "errored") status = "failed";
      else status = "in_progress";
      if (known === status) continue;
      st.turn.tools.set(toolCallId, status);
      const toolName = payload.toolName ?? st.toolNames?.get(toolCallId) ?? toolCallId;
      st.toolNames ??= new Map();
      st.toolNames.set(toolCallId, toolName);
      // 已流式送达的输入被服务端剥离时，回填 tool_call 事件留档的完整输入
      const input = payload.input !== undefined ? payload.input : st.toolInputs?.get(toolCallId);
      const locations = deriveToolLocations(input);
      // 结果字段实测为 result（content + display.structuredPatch）；output 为旧快照兼容
      const result = payload.result ?? payload.output;
      const diffBlocks = toolResultDiffBlocks(result);
      this._update(st.sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId,
        name: toolName,
        title: deriveToolTitle(toolName, input),
        kind: toolNameToKind(toolName),
        status,
        ...(locations.length ? { locations } : {}),
        ...(input !== undefined ? { rawInput: input } : {}),
        ...(diffBlocks.length ? { content: diffBlocks } : {}),
        ...(result !== undefined && result !== null ? { rawOutput: toolResultText(result) } : {}),
      });
    }
  }

  // ---------- 服务端反向请求 ----------

  async _answerServer(method, params) {
    if (method === "session/requestRuntimePreferences") {
      return { nativeSearchEnhancementsEnabled: false };
    }
    if (method === "interaction/requestPermission") {
      const decision = this.onPermissionRequest
        ? await this.onPermissionRequest({
            sessionId: params?.sessionId,
            toolCallId: params?.toolCallId ?? params?.requestId,
            toolName: params?.toolName,
            riskLevel: params?.riskLevel,
            reason: params?.reason,
            input: params?.input,
          })
        : "deny";
      return { decision: decision === "allow" ? "allow" : "deny" };
    }
    if (method === "interaction/requestProviderRuntimeHeaders") {
      // 账号型 provider（如 GLM 编码套餐）的鉴权：从共享凭据库取对应 api-key
      const apiKey = this._credentialsApiKey(params?.providerId);
      if (apiKey) return { headersApplied: true, requestAuth: { apiKey } };
      return { headersApplied: false };
    }
    if (method === "interaction/requestUserInput") {
      // zcode AskUserQuestion 等提问 → ACP elicitation；answers 按 question 文本为键
      const question = params?.questions?.[0];
      if (!question?.question) return { action: "cancel", reason: "no question" };
      if (!this.onElicitation) return { action: "cancel", reason: "no elicitation client" };
      const r = await Promise.resolve(
        this.onElicitation({
          sessionId: params?.sessionId,
          message: [question.header, question.question].filter(Boolean).join("："),
          options: (question.options ?? []).map((o) => ({ label: o.label ?? o.value, description: o.description })),
        }),
      ).catch(() => null);
      if (!r || r.action !== "accept" || typeof r.choice !== "string") {
        return { action: r?.action === "decline" ? "decline" : "cancel" };
      }
      const answers = question.multiSelect
        ? { [question.question]: [r.choice] }
        : { [question.question]: r.choice };
      return { action: "accept", content: { answers } };
    }
    if (method === "interaction/requestOfficialMcpAuthHeaders") {
      return {};
    }
    return {};
  }

  _credentialsFile() {
    const fromEnv = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
    if (fromEnv) return path.join(path.dirname(fromEnv), "credentials.json");
    return this.credentialsPath;
  }

  // 从共享凭据库查 provider 的 api-key（键形如
  // account-provider:coding-plan:account:<providerId>:account:<账号>:api-key），mtime 变化即重读。
  // 值为 `enc:v1:` 加密（aes-256-gcm），解密密钥与 CLI 一致：env secret，缺省按
  // 平台/主目录/用户名派生的回退密钥（zcode 自身的 resolveCredentialSecret 行为）。
  _credentialsApiKey(providerId) {
    if (!providerId) return null;
    const short = providerId.replace(/^account:/, "");
    const file = this._credentialsFile();
    let cache = this._credentialsCache;
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (!cache || cache.file !== file || cache.mtime !== mtime) {
        cache = { file, mtime, raw: JSON.parse(fs.readFileSync(file, "utf8")) };
        this._credentialsCache = cache;
      }
    } catch {
      return null;
    }
    for (const [k, v] of Object.entries(cache.raw ?? {})) {
      if (!k.includes(`:${short}:`) || !k.endsWith(":api-key")) continue;
      if (typeof v !== "string" || !v) continue;
      const plain = this._decryptCredential(v);
      if (plain === null) continue;
      try {
        const parsed = JSON.parse(plain);
        if (parsed && typeof parsed === "object" && typeof parsed.apiKey === "string") return parsed.apiKey;
      } catch {}
      return plain;
    }
    return null;
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

  // ---------- 模型目录与配置选项 ----------

  async _refreshCatalog(waitMs = CATALOG_WAIT_MS) {
    if (this.catalog) return this.catalog;
    await new Promise((resolve) => {
      const onChange = (msg) => {
        if (msg.method === "state.updated" && msg.params?.patch?.model?.available) finish();
      };
      const finish = () => {
        clearTimeout(timer);
        this.client.removeListener("notification", onChange);
        resolve();
      };
      const timer = setTimeout(finish, waitMs);
      this.client.on("notification", onChange);
    });
    return this.catalog;
  }

  _catalogEntry(modelKey) {
    return (this.catalog ?? []).find((e) => `${e.ref?.providerId}/${e.ref?.modelId}` === modelKey) ?? null;
  }

  // 目录按 model 合并：settings 快照是全量，state 补丁只含当前选中 provider 的模型集
  _mergeCatalog(existing, incoming) {
    const merged = new Map();
    for (const e of existing ?? []) {
      const k = e.ref?.providerId && e.ref?.modelId ? `${e.ref.providerId}/${e.ref.modelId}` : null;
      if (k) merged.set(k, e);
    }
    for (const e of incoming ?? []) {
      const k = e.ref?.providerId && e.ref?.modelId ? `${e.ref.providerId}/${e.ref.modelId}` : null;
      if (k) merged.set(k, e);
    }
    return [...merged.values()];
  }

  _currentCatalogEntry(st) {
    if (!st.model) return null;
    return this._catalogEntry(`${st.model.providerId}/${st.model.modelId}`);
  }

  _adoptModel(st, model) {
    if (!model) return;
    if (model.ref) {
      st.model = { providerId: model.ref.providerId, modelId: model.ref.modelId };
    } else if (model.providerId && model.modelId) {
      st.model = { providerId: model.providerId, modelId: model.modelId };
    }
    const level = model.options?.reasoningLevel;
    if (level) st.reasoning = level;
  }

  _configOptions(st) {
    const options = [
      {
        configId: "zcode.mode",
        name: "Permission Mode",
        description:
          "zcode --mode. yolo auto-approves tool calls; build/edit/guarded raise permission requests; plan stays read-only.",
        category: "mode",
        type: "select",
        currentValue: st.mode,
        options: MODE_VALUES.map((id) => ({
          value: id,
          name: MODE_PRESENTATION[id].name,
          description: MODE_PRESENTATION[id].description,
        })),
      },
    ];
    const catalog = this.catalog ?? [];
    if (catalog.length) {
      const currentKey = st.model ? `${st.model.providerId}/${st.model.modelId}` : null;
      options.push({
        configId: "zcode.model",
        name: "Model",
        category: "model",
        type: "select",
        ...(currentKey ? { currentValue: currentKey } : {}),
        options: catalog.map((e) => ({
          value: `${e.ref.providerId}/${e.ref.modelId}`,
          name: e.label ?? e.ref.modelId,
          description: [e.providerLabel, typeof e.contextWindow === "number" ? `context ${e.contextWindow}` : null]
            .filter(Boolean)
            .join(" · "),
        })),
      });
      const entry = this._currentCatalogEntry(st) ?? catalog[0];
      const levels = entry?.reasoning?.levels ?? [];
      if (levels.length) {
        options.push({
          configId: "zcode.reasoning",
          name: "Thinking",
          description: `Reasoning effort of ${entry.label ?? entry.ref.modelId}`,
          category: "thought_level",
          type: "select",
          ...(st.reasoning ? { currentValue: st.reasoning } : {}),
          options: levels.map((l) => ({ value: l.value, name: l.label ?? l.value })),
        });
      }
    }
    // 思考流出线开关（适配器本地，不改模型的实际思考档位）
    options.push({
      configId: "zcode.thinking_display",
      name: "Thinking Display",
      description:
        "Show the model's reasoning stream: concise hides it, full streams it live. Display-only; does not change the model's reasoning effort.",
      category: "thought_level",
      type: "select",
      currentValue: st.thinkingDisplay,
      options: [
        { value: "concise", name: "精简 (Concise)", description: "隐藏思考流，只看回复与工具卡片" },
        { value: "full", name: "完整 (Full)", description: "实时显示模型思考流" },
      ],
    });
    return options;
  }

  // 组装 ACP 斜杠命令表（与无头桥接一致：服务端生效的内置命令 + zcode 命令/技能清单）
  _availableCommands(cwd) {
    return buildAvailableCommands(
      () => this._listCliCommands(this.bin, cwd),
      () => this._listCliSkills(this.bin, cwd),
    );
  }

  // 历史回放（sqlite 只读；v1 session/load 与 v2 replayFrom:start 共用）
  async _replayFromStore(sessionId) {
    const st = this._state(sessionId);
    const history = await this._readHistory(sessionId);
    let userN = 0;
    let agentN = 0;
    for (const entry of history) {
      if (entry.role === "user") {
        this._update(sessionId, {
          sessionUpdate: "user_message",
          messageId: `msg_user_r${++userN}`,
          content: [{ type: "text", text: entry.text }],
        });
      } else if (entry.role === "assistant") {
        if (entry.thoughts.length && st.thinkingDisplay === "full") {
          this._update(sessionId, {
            sessionUpdate: "agent_thought",
            messageId: `msg_thought_r${agentN}`,
            content: entry.thoughts.map((t) => ({ type: "text", text: t })),
          });
        }
        for (const tool of entry.tools) {
          const status = mapToolStatus(tool.status);
          const locations = deriveToolLocations(tool.input);
          const diffBlocks = toolResultDiffBlocks(tool.output);
          this._update(sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: `tool_r_${tool.callId ?? uuid().slice(0, 8)}`,
            name: tool.tool,
            title: deriveToolTitle(tool.tool, tool.input),
            kind: toolNameToKind(tool.tool),
            status,
            ...(locations.length ? { locations } : {}),
            ...(tool.input !== undefined ? { rawInput: tool.input } : {}),
            ...(diffBlocks.length ? { content: diffBlocks } : {}),
            ...(tool.output !== undefined && tool.output !== null ? { rawOutput: toolResultText(tool.output) } : {}),
          });
        }
        if (entry.texts.length) {
          this._update(sessionId, {
            sessionUpdate: "agent_message",
            messageId: `msg_agent_r${++agentN}`,
            content: [{ type: "text", text: entry.texts.join("\n") }],
          });
        }
      }
    }
  }
}

function mapToolStatus(status) {
  switch (status) {
    case "completed":
      return "completed";
    case "errored":
    case "failed":
      return "failed";
    case "stopped":
    case "cancelled":
      return "cancelled";
    case "running":
      return "in_progress";
    default:
      return "completed";
  }
}

// app-server turn 终态 → ACP stopReason（v1/v2 共用枚举，v1 由方言层回落 end_turn）
function mapStopReason(status) {
  switch (status) {
    case undefined:
    case null:
    case "success":
      return "end_turn";
    case "refusal":
    case "refused":
      return "refusal";
    case "max_tokens":
    case "max_output_tokens":
    case "context_length":
      return "max_tokens";
    default:
      return "error";
  }
}
