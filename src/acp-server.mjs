// ACP Agent 服务端：面向 Zed 等 ACP 客户端，initialize 按对端请求的版本协商 v1/v2 方言
// （已发布的 Zed 只说 v1），session/* 分派给无头 SessionBridge，更新以 session/update 通知发出。
import { LineRpc, ERR, jsonRpcError } from "./rpc.mjs";
import { V1Dialect } from "./acp-v1.mjs";
import { toolNameToKind, deriveToolTitle } from "./content.mjs";

const PROTOCOL_VERSION = 2;
const AGENT_INFO = { name: "zcode-acp", title: "ZCode", version: "0.2.0" };

export class AcpAgent {
  constructor({ bridge, log }) {
    this.bridge = bridge;
    this.log = log ?? (() => {});
    this.rpc = new LineRpc({ withJsonRpc: true });
    this.initialized = false;
    this.version = null; // 协商后的协议版本：1 或 2
    this.clientCapabilities = {};
    this.v1 = new V1Dialect({ agent: this, bridge, log, info: AGENT_INFO });

    this.rpc.on("request", (msg) => {
      this._handleRequest(msg)
        .then((result) => this.rpc.respond(msg.id, result))
        .catch((err) => {
          this.log(`acp: ${msg.method} failed:`, err.message ?? err);
          this.rpc.respondError(msg.id, err.code ?? ERR.INTERNAL, err.message ?? String(err), err.data);
        });
    });
    this.rpc.on("notification", (msg) => this._handleNotification(msg).catch(() => {}));
  }

  attach(input, output) {
    this.rpc.attach(input, output);
  }

  async _handleRequest(msg) {
    const { id, method, params } = msg;
    if (!this.initialized && method !== "initialize") {
      throw jsonRpcError(ERR.INVALID_REQUEST, "connection not initialized");
    }
    switch (method) {
      case "initialize":
        return this._initialize(id, params);
      case "ping":
        return {};
      default:
        break;
    }
    if (this.version === 1) return this.v1.handleRequest(msg);
    switch (method) {
      case "session/new":
        return this.bridge.createNew({ cwd: required(params, "cwd") });
      case "session/prompt":
        return this.bridge.prompt({
          sessionId: required(params, "sessionId"),
          blocks: required(params, "prompt"),
        });
      case "session/cancel":
        return this.bridge.cancel(required(params, "sessionId"));
      case "session/resume":
        return this.bridge.resume({
          sessionId: required(params, "sessionId"),
          cwd: params.cwd,
          replayFrom: params.replayFrom,
        });
      case "session/list":
        return this.bridge.list({ cwd: params.cwd, cursor: params.cursor });
      case "session/close":
        return this.bridge.close(required(params, "sessionId"));
      case "session/set_config_option":
        return this.bridge.setConfigOption({
          sessionId: required(params, "sessionId"),
          configId: required(params, "configId"),
          value: params,
        });
      default:
        throw jsonRpcError(ERR.METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  async _initialize(id, params) {
    const requested = params?.protocolVersion;
    if (!Number.isInteger(requested) || requested < 1) {
      throw jsonRpcError(ERR.INVALID_PARAMS, "invalid protocolVersion");
    }
    // 服务对端支持的最新版本：低于 2 的客户端走 v1 方言（已发布的 Zed 请求 1）
    this.version = Math.min(requested, PROTOCOL_VERSION);
    this.clientCapabilities = params?.capabilities ?? params?.clientCapabilities ?? {};
    this.initialized = true;
    if (this.version === 1) return this.v1.initializeResult();
    return {
      protocolVersion: PROTOCOL_VERSION,
      // 无头后端按 turn 起进程，无 MCP 透传通道，只声明基线会话能力；
      // prompt.image/audio：两个后端均支持（app-server 附件上传 / headless --attach），
      // 模型是否实际消费取决于其 inputFormat（同 image 在非视觉模型上的行为）
      capabilities: {
        session: {
          prompt: { image: {}, audio: {} },
        },
      },
      info: { ...AGENT_INFO },
      authMethods: [],
    };
  }

  async _handleNotification(msg) {
    if (msg.method === "notifications/initialized") return;
    // session/cancel 在 ACP 里是无 id 通知（Zed 中止按钮走此形态）；带 id 的请求形态由 _handleRequest 分派
    if (msg.method === "session/cancel") {
      if (!this.initialized || !msg.params?.sessionId) return;
      this.bridge.cancel(msg.params.sessionId).catch((err) =>
        this.log(`acp: session/cancel failed: ${err?.message ?? err}`),
      );
      return;
    }
    // $/cancel_request：客户端撤销我方未应答的反向请求（权限/提问），按 -32800 收敛
    if (msg.method === "$/cancel_request") {
      const id = msg.params?.id;
      const waiter = id !== undefined ? this.rpc.pending.get(id) : undefined;
      if (waiter) {
        this.rpc.pending.delete(id);
        waiter.reject(jsonRpcError(ERR.REQUEST_CANCELLED, "request cancelled"));
        this.rpc.respondError(id, ERR.REQUEST_CANCELLED, "request cancelled");
      }
    }
  }

  sendUpdate(sessionId, update) {
    if (this.version === 1) return this.v1.routeUpdate(sessionId, update);
    this.notifyUpdate(sessionId, update);
  }

  notifyUpdate(sessionId, update) {
    this.rpc.notify("session/update", { sessionId, update });
  }

  // 桥接层的单选提问（app-server interaction/requestUserInput）→ ACP 表单式 elicitation，
  // 应答映射回 {action, answers}。客户端无响应/超时按 cancel 收敛。
  // 挂起期间按 v2 规范报 requires_action，应答后 turn 仍在进行则回 running（v1 方言抑制非 idle 态）。
  async requestElicitation(req) {
    const { sessionId } = req;
    const labels = (req.options ?? []).map((o) => o.label).filter(Boolean);
    if (!labels.length) return { action: "cancel" };
    // multiSelect：array + items.enum 表单（客户端按多选渲染）；单选为 string enum
    const choiceSchema = req.multiSelect
      ? { type: "array", items: { type: "string", enum: labels }, uniqueItems: true }
      : { type: "string", enum: labels };
    const params = {
      sessionId,
      mode: "form",
      message: req.message || "Choose an option",
      requestedSchema: {
        type: "object",
        properties: { choice: choiceSchema },
        required: ["choice"],
      },
    };
    this.sendUpdate(sessionId, { sessionUpdate: "state_update", state: "requires_action" });
    const answer = await Promise.race([
      this.rpc.request("elicitation/create", params).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 180000)),
    ]);
    this._resumeRunning(sessionId);
    if (!answer || answer.action !== "accept") {
      return { action: answer?.action === "decline" ? "decline" : "cancel" };
    }
    const choice = answer.content?.choice;
    if (req.multiSelect) {
      const arr = (Array.isArray(choice) ? choice : typeof choice === "string" ? [choice] : []).filter((v) => labels.includes(v));
      return arr.length ? { action: "accept", choices: arr } : { action: "cancel" };
    }
    if (typeof choice !== "string" || !labels.includes(choice)) return { action: "cancel" };
    return { action: "accept", choice };
  }

  // 桥接层的权限请求 → ACP 客户端（Zed 权限弹窗），应答映射回 allow/deny。
  // 客户端无响应或取消时按 deny 收敛（安全默认）。
  async requestPermission({ sessionId, toolCallId, toolName, riskLevel, reason, input }) {
    const toolCall = {
      toolCallId: toolCallId ?? `perm_${Date.now()}`,
      title: deriveToolTitle(toolName, input),
      kind: toolNameToKind(toolName),
      status: "in_progress",
      ...(input !== undefined ? { rawInput: input } : {}),
    };
    const options = [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ];
    const params =
      this.version === 1
        ? {
            sessionId,
            options,
            toolCall,
          }
        : {
            sessionId,
            options,
            title: toolName ?? "tool",
            ...(reason ? { description: reason } : {}),
            subject: { type: "tool_call", toolCallUpdate: toolCall },
          };
    this.sendUpdate(sessionId, { sessionUpdate: "state_update", state: "requires_action" });
    const answer = await Promise.race([
      this.rpc.request("session/request_permission", params).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 180000)),
    ]);
    this._resumeRunning(sessionId);
    const outcome = answer?.outcome;
    if (outcome?.outcome !== "selected") return "deny";
    return outcome.optionId === "allow" ? "allow" : "deny";
  }

  // requires_action 收束后的状态回落：turn 仍在进行才报 running（等待期间 turn 被取消则不发）
  _resumeRunning(sessionId) {
    const st = this.bridge?.sessions?.get?.(sessionId);
    if (!st || st.turn === null || st.turn === undefined) return;
    this.sendUpdate(sessionId, { sessionUpdate: "state_update", state: "running" });
  }
}

function required(params, key) {
  if (params?.[key] === undefined || params?.[key] === null) {
    throw jsonRpcError(ERR.INVALID_PARAMS, `missing required param: ${key}`);
  }
  return params[key];
}
