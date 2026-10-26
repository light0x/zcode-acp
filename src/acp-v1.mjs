// ACP v1 方言：面向仅支持协议版本 1 的客户端（如当前已发布的 Zed）。
// 桥接层以 v2 形状为内部事件规范，本模块负责：
//   1. v1 方法面：session/new、session/load、session/resume、session/prompt、
//      session/cancel、session/set_mode；
//   2. 更新翻译：v2 整消息更新拆为 v1 分块、首个 tool_call_update 前合成 tool_call、
//      抑制 state_update 出线（转用于应答 session/prompt 的 stopReason）。
import { ERR, jsonRpcError } from "./rpc.mjs";
import { toolNameToKind, deriveToolTitle } from "./content.mjs";

const CHUNK_VARIANTS = {
  user_message: "user_message_chunk",
  agent_message: "agent_message_chunk",
  agent_thought: "agent_thought_chunk",
};

// v2 → v1 配置项形状：v1 线上字段为 id（非 configId），其余一致（type/currentValue/options/category）
function configOptionToV1(option) {
  if (!option) return option;
  const { configId, ...rest } = option;
  return { ...rest, ...(configId !== undefined ? { id: configId } : {}) };
}

function configOptionsToV1(options) {
  return (options ?? []).map(configOptionToV1);
}

export class V1Dialect {
  // agent: AcpAgent（提供 notifyUpdate 出线）；bridge: SessionBridge；info: agentInfo
  constructor({ agent, bridge, log, info }) {
    this.agent = agent;
    this.bridge = bridge;
    this.log = log ?? (() => {});
    this.info = info;
    this.pending = new Map(); // sessionId -> [{ resolve }]，等待各自 turn 的 idle
    this.announced = new Map(); // sessionId -> Set(toolCallId)
  }

  initializeResult() {
    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: false },
        mcpCapabilities: {},
        sessionCapabilities: { list: {}, resume: {}, close: {} },
      },
      agentInfo: { ...this.info },
      authMethods: [],
    };
  }

  async handleRequest(msg) {
    const { method, params } = msg;
    switch (method) {
      case "session/new":
        return this._sessionNew(params);
      case "session/load":
        return this._sessionLoadOrResume(required(params, "sessionId"), params.cwd, true);
      case "session/resume":
        return this._sessionLoadOrResume(required(params, "sessionId"), params.cwd, false);
      case "session/prompt":
        return this._sessionPrompt(params);
      case "session/cancel":
        return this.bridge.cancel(required(params, "sessionId"));
      case "session/set_mode":
        return this._setMode(params);
      case "session/set_config_option":
        return this._setConfigOption(params);
      case "session/list":
        return this.bridge.list({ cwd: params?.cwd, cursor: params?.cursor });
      case "session/close":
        return this.bridge.close(required(params, "sessionId"));
      default:
        throw jsonRpcError(ERR.METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  async _sessionNew(params) {
    const r = await this.bridge.createNew({ cwd: required(params, "cwd") });
    const cfg = (r.configOptions ?? []).find((o) => o.configId === "zcode.mode");
    const result = { sessionId: r.sessionId };
    if (cfg) {
      result.modes = {
        currentModeId: cfg.currentValue,
        available: cfg.options.map((v) => ({ id: v.value, name: v.name, description: v.description })),
      };
    }
    if (r.configOptions?.length) result.configOptions = configOptionsToV1(r.configOptions);
    // v1 的 NewSessionResponse 没有 availableCommands 字段：命令只能经
    // available_commands_update 通知送达，但客户端在响应注册会话前会丢弃该通知
    // （Zed 日志: unknown session）。推迟到响应出线之后发送。
    const commands = r.availableCommands;
    const sessionId = r.sessionId;
    setTimeout(() => {
      try {
        this._announceCommands(sessionId, commands);
      } catch {}
    }, 0);
    return result;
  }

  // v1 session/load 要求回放完历史再应答 {}；session/resume 不回放
  async _sessionLoadOrResume(sessionId, cwd, replay) {
    const r = await this.bridge.resume({
      sessionId,
      cwd,
      ...(replay ? { replayFrom: { type: "start" } } : {}),
    });
    this._announceCommands(sessionId, r.availableCommands);
    return {};
  }

  // 先登记等待者再发起 prompt：bridge.prompt 外层是 async 包装，若 await 后才登记，
  // 立即完成的 turn 会在登记前分发 idle，等待者将永远挂起
  _sessionPrompt(params) {
    const sessionId = required(params, "sessionId");
    const blocks = required(params, "prompt");
    return new Promise((resolve, reject) => {
      const list = this.pending.get(sessionId) ?? [];
      const waiter = { resolve };
      list.push(waiter);
      this.pending.set(sessionId, list);
      this.bridge.prompt({ sessionId, blocks }).catch((err) => {
        const l = this.pending.get(sessionId) ?? [];
        const i = l.indexOf(waiter);
        if (i >= 0) l.splice(i, 1);
        reject(err);
      });
    }).then((stopReason) => ({ stopReason }));
  }

  async _setMode(params) {
    const sessionId = required(params, "sessionId");
    const modeId = required(params, "modeId");
    const r = await this.bridge.setConfigOption({ sessionId, configId: "zcode.mode", value: { type: "id", value: modeId } });
    this.agent.notifyUpdate(sessionId, { sessionUpdate: "current_mode_update", currentModeId: modeId });
    return r;
  }

  async _setConfigOption(params) {
    const sessionId = required(params, "sessionId");
    const r = await this.bridge.setConfigOption({
      sessionId,
      configId: required(params, "configId"),
      value: params,
    });
    const configOptions = configOptionsToV1(r?.configOptions);
    this.agent.notifyUpdate(sessionId, { sessionUpdate: "config_option_update", configOptions });
    return { configOptions };
  }

  // v2 更新 → 0..n 条 v1 session/update；state_update 不出线，仅用于结束挂起的 prompt
  routeUpdate(sessionId, update) {
    switch (update.sessionUpdate) {
      case "user_message":
      case "agent_message":
      case "agent_thought": {
        const variant = CHUNK_VARIANTS[update.sessionUpdate];
        for (const block of update.content ?? []) {
          this.agent.notifyUpdate(sessionId, {
            sessionUpdate: variant,
            ...(update.messageId !== undefined ? { messageId: update.messageId } : {}),
            content: block,
          });
        }
        return;
      }
      case "tool_call_update":
        this._toolCall(sessionId, update);
        return;
      case "agent_message_chunk":
      case "agent_thought_chunk":
      case "user_message_chunk":
      case "config_option_update":
        // 桥接直出的分块与配置变更通知在 v1 上形状一致，原样透传
        this.agent.notifyUpdate(sessionId, update);
        return;
      case "available_commands_update":
        // v1 线上 input 无 type 标签，剥掉
        this.agent.notifyUpdate(sessionId, {
          sessionUpdate: "available_commands_update",
          availableCommands: (update.availableCommands ?? []).map((c) => ({
            name: c.name,
            description: c.description ?? "",
            ...(c.input?.hint ? { input: { hint: c.input.hint } } : {}),
          })),
        });
        return;
      case "plan_update":
        // v2 plan_update → v1 plan（v1 无 planId，整表替换语义一致）
        this.agent.notifyUpdate(sessionId, {
          sessionUpdate: "plan",
          entries: update.plan?.entries ?? [],
        });
        return;
      case "usage_update":
        this.agent.notifyUpdate(sessionId, update);
        return;
      case "state_update": {
        if (update.state !== "idle") return;
        if (update.stopReason === "error" && update.error?.message) {
          // v1 没有 error 停止原因：错误文本作为消息分块送达，再以 end_turn 收束
          this.agent.notifyUpdate(sessionId, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `[error] ${update.error.message}` },
          });
        }
        const waiter = (this.pending.get(sessionId) ?? []).shift();
        waiter?.resolve(v1StopReason(update.stopReason));
        return;
      }
      default:
        // 其余 v2 专属变体（config_option_update 等）在 v1 上不出线
        return;
    }
  }

  _toolCall(sessionId, update) {
    const seen = this.announced.get(sessionId) ?? new Set();
    const first = !seen.has(update.toolCallId);
    if (first) {
      seen.add(update.toolCallId);
      this.announced.set(sessionId, seen);
      this.agent.notifyUpdate(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: update.toolCallId,
        title: update.title ?? deriveToolTitle(update.name, update.rawInput),
        kind: update.kind ?? toolNameToKind(update.name),
        status: v1ToolStatus(update.status),
        ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
      });
    } else {
      this.agent.notifyUpdate(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: update.toolCallId,
        ...(update.title !== undefined ? { title: update.title } : {}),
        ...(update.status !== undefined ? { status: v1ToolStatus(update.status) } : {}),
      });
    }
    if (update.rawOutput !== undefined && update.rawOutput !== null) {
      this.agent.notifyUpdate(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: update.toolCallId,
        status: v1ToolStatus(update.status),
        content: [{ type: "content", content: { type: "text", text: outputToText(update.rawOutput) } }],
      });
    }
  }

  _announceCommands(sessionId, commands) {
    if (!commands?.length) return;
    this.agent.notifyUpdate(sessionId, {
      sessionUpdate: "available_commands_update",
      availableCommands: commands.map((c) => ({
        name: c.name,
        description: c.description ?? "",
        ...(c.input?.hint ? { input: { hint: c.input.hint } } : {}),
      })),
    });
  }
}

// v1 停止原因枚举无 error；合法枚举照搬，error 回落 end_turn
function v1StopReason(stopReason) {
  return ["cancelled", "refusal", "max_tokens", "max_turn_requests"].includes(stopReason) ? stopReason : "end_turn";
}

// v1 工具状态枚举没有 cancelled，映射为 failed
function v1ToolStatus(status) {
  return status === "cancelled" ? "failed" : (status ?? "pending");
}

function outputToText(rawOutput) {
  const text = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput) ?? "";
  return text.length > 100000 ? `${text.slice(0, 100000)}…` : text;
}

function required(params, key) {
  if (params?.[key] === undefined || params?.[key] === null) {
    throw jsonRpcError(ERR.INVALID_PARAMS, `missing required param: ${key}`);
  }
  return params[key];
}
