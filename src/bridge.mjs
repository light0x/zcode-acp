// 无头会话桥接：把 ACP v2 方法翻译为「每 turn 一个 zcode -p 进程」的执行模型。
// 会话 ID：本地新建的会话用 acp_ 前缀 ID（首次 prompt 后关联 zcode 真实 sess_* ID）；
// resume/list 使用 zcode 原生 sess_* ID（直接来自 sqlite 会话存储）。
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAvailableCommands, splitPromptBlocks, extForMime, toolNameToKind, deriveToolTitle, MODE_PRESENTATION } from "./content.mjs";
import {
  runPrompt,
  resolveZcodeBin,
  listSessions,
  getSession,
  readHistory,
  listCliCommands,
  listCliSkills,
} from "./zcode-headless.mjs";

const MODE_VALUES = ["plan", "build", "edit", "yolo", "guarded"];

function uuid() {
  return crypto.randomUUID();
}

export class SessionBridge {
  // deps: { sendUpdate(sessionId, update), log(...args) }
  constructor(deps) {
    Object.assign(this, deps);
    this.bin = resolveZcodeBin();
    // 外部依赖挂到实例上，测试可注入替身
    this._runPrompt = runPrompt;
    this._listSessions = listSessions;
    this._getSession = getSession;
    this._readHistory = readHistory;
    this._listCliCommands = listCliCommands;
    this._listCliSkills = listCliSkills;
    this.sessions = new Map(); // acpSessionId -> 会话状态
  }

  _state(sessionId) {
    let st = this.sessions.get(sessionId);
    if (!st) {
      st = {
        cwd: null,
        // 无头进程没有权限客户端，build 等模式的写操作确认无法进行；
        // zcode headless 的默认即 yolo（自动放行），与之保持一致
        mode: "yolo",
        zcodeId: null, // zcode 真实会话 ID（首次 turn 后建立）
        running: null, // { proc, acpMessageId, cancelWaiters }
        queue: [],
        lastAgentN: 0,
        userN: 0,
        closed: false,
      };
      this.sessions.set(sessionId, st);
    }
    return st;
  }

  _update(sessionId, update) {
    this.sendUpdate(sessionId, update);
  }

  // ---------- ACP 方法 ----------

  async createNew({ cwd, mode }) {
    const sessionId = `acp_${uuid()}`;
    const st = this._state(sessionId);
    st.cwd = cwd;
    if (mode && MODE_VALUES.includes(mode)) st.mode = mode;
    const availableCommands = await this._availableCommands(cwd);
    st.lastCommands = JSON.stringify(availableCommands);
    return {
      sessionId,
      configOptions: this._configOptions(sessionId),
      availableCommands,
    };
  }

  // 重算斜杠命令表，变化时以 available_commands_update 全量替换
  // （触发点：模式切换、turn 结束；v1 方言层负责形状翻译）
  async _refreshCommands(sessionId) {
    const st = this._state(sessionId);
    if (!st.cwd) return;
    try {
      const commands = await this._availableCommands(st.cwd);
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

  // 组装 ACP 斜杠命令表：服务端生效的内置命令（/compact、/skill）
  // 加上 zcode 的自定义/插件命令；技能清单拼进 /skill 的描述供用户挑选。
  _availableCommands(cwd) {
    return buildAvailableCommands(
      () => this._listCliCommands(this.bin, cwd),
      () => this._listCliSkills(this.bin, cwd),
    );
  }

  async prompt({ sessionId, blocks }) {
    const st = this._state(sessionId);
    if (st.closed) throw Object.assign(new Error("session is closed"), { code: -32602 });
    if (!st.cwd) throw Object.assign(new Error("unknown session"), { code: -32602 });
    const { text, media } = splitPromptBlocks(blocks);
    const messageId = `msg_user_${++st.userN}_${uuid().slice(0, 8)}`;
    // 插入即完成：本地记录并上报后立即响应，turn 异步执行
    this._update(sessionId, {
      sessionUpdate: "user_message",
      messageId,
      content: [
        { type: "text", text },
        ...media.map((m) => ({ type: m.mimeType.startsWith("audio/") ? "audio" : "image", data: m.data, mimeType: m.mimeType })),
      ],
    });
    return new Promise((resolve) => {
      st.queue.push({ text, media, messageId });
      resolve({ messageId });
      this._drain(sessionId);
    });
  }

  _drain(sessionId) {
    const st = this._state(sessionId);
    if (st.running || st.closed) return;
    const next = st.queue.shift();
    if (!next) return;
    this._runTurn(sessionId, next).catch((err) => this.log(`turn failed: ${err?.message ?? err}`));
  }

  async _runTurn(sessionId, { text, media }) {
    const st = this._state(sessionId);
    this._update(sessionId, { sessionUpdate: "state_update", state: "running" });
    const agentMsgId = `msg_agent_${++st.lastAgentN}_${uuid().slice(0, 8)}`;
    const thoughtMsgId = `msg_thought_${st.lastAgentN}_${uuid().slice(0, 8)}`;
    let textLen = 0;
    // 图片块落临时文件，经官方 --attach 送达；turn 结束后清理
    const attachPaths = [];
    for (const [i, img] of (media ?? []).entries()) {
      try {
        const ext = extForMime(img.mimeType);
        const p = path.join(os.tmpdir(), `zcode-acp-media-${sessionId.slice(0, 12)}-${Date.now()}-${i}.${ext}`);
        fs.writeFileSync(p, Buffer.from(img.data, "base64"));
        attachPaths.push(p);
      } catch {
        // 单张写盘失败不阻断 turn
      }
    }
    const run = this._runPrompt({
      bin: this.bin,
      text,
      cwd: st.cwd,
      mode: st.mode,
      resumeId: st.zcodeId,
      attachPaths,
      // 官方 --output-format stream-json 的流式增量 → ACP 分块
      onStreamEvent: (ev) => {
        const delta = ev?.delta ?? "";
        if (!delta) return;
        if (ev.kind === "reasoning_delta") {
          this._update(sessionId, {
            sessionUpdate: "agent_thought_chunk",
            messageId: thoughtMsgId,
            content: { type: "text", text: delta },
          });
        } else if (ev.kind === "text_delta") {
          textLen += delta.length;
          this._update(sessionId, {
            sessionUpdate: "agent_message_chunk",
            messageId: agentMsgId,
            content: { type: "text", text: delta },
          });
        }
      },
    });
    st.running = run;
    try {
      const result = await run.done;
      if (result.sessionId && result.sessionId !== st.zcodeId) {
        st.zcodeId = result.sessionId;
      }
      const response = typeof result.response === "string" ? result.response : "";
      // 流式未送达任何文本时（旧构建无 stream-json 等），用最终回复整段兜底
      if (response && !textLen) {
        this._update(sessionId, {
          sessionUpdate: "agent_message",
          messageId: agentMsgId,
          content: [{ type: "text", text: response }],
        });
      }
      this._emitUsage(sessionId, result.usage, result.projection);
      this._update(sessionId, {
        sessionUpdate: "state_update",
        state: "idle",
        stopReason: "end_turn",
      });
    } catch (err) {
      if (err?.cancelled) {
        this._update(sessionId, {
          sessionUpdate: "state_update",
          state: "idle",
          stopReason: "cancelled",
        });
      } else {
        this._update(sessionId, {
          sessionUpdate: "state_update",
          state: "idle",
          stopReason: "error",
          error: { code: err?.code ?? -32603, message: err?.message ?? "zcode turn failed" },
        });
      }
    } finally {
      for (const p of attachPaths) {
        try {
          fs.rmSync(p, { force: true });
        } catch {}
      }
      st.running = null;
      const waiters = st.cancelWaiters ? [...st.cancelWaiters] : [];
      st.cancelWaiters = [];
      for (const w of waiters) w();
      this._refreshCommands(sessionId);
      this._drain(sessionId);
    }
  }

  async cancel(sessionId) {
    const st = this._state(sessionId);
    st.queue.length = 0;
    if (st.running) {
      // _runTurn 捕获到取消后发 idle(cancelled) 并在 finally 唤醒等待者；此处兜底超时
      await new Promise((resolve) => {
        const timer = setTimeout(finish, 5000);
        (st.cancelWaiters ??= []).push(() => {
          clearTimeout(timer);
          resolve();
        });
        function finish() {
          resolve();
        }
        // 平台无关取消：句柄内部置 cancelled 标志并 kill
        // （Windows 上 kill 不产生 SIGTERM exit 信号，标志位才是判定依据）
        st.running.cancel?.();
      });
    }
    return {};
  }

  async resume({ sessionId, cwd, replayFrom }) {
    if (replayFrom !== undefined && replayFrom !== null && replayFrom?.type !== "start") {
      throw Object.assign(new Error(`unsupported replayFrom type: ${replayFrom?.type}`), { code: -32602 });
    }
    const st = this._state(sessionId);
    st.closed = false;
    if (sessionId.startsWith("acp_")) {
      // 本地会话：仅当本连接内创建过才可恢复
      if (!st.cwd) throw Object.assign(new Error(`unknown session: ${sessionId}`), { code: -32602 });
      if (cwd && cwd !== st.cwd) st.cwd = cwd;
    } else {
      // zcode 原生会话 ID：从会话存储验证
      const info = await this._getSession(sessionId);
      if (!info) throw Object.assign(new Error(`session not found: ${sessionId}`), { code: -32602 });
      st.cwd = cwd ?? info.cwd;
      st.zcodeId = sessionId;
      if (replayFrom?.type === "start") await this._replayFromStore(sessionId);
    }
    this._update(sessionId, { sessionUpdate: "state_update", state: "idle" });
    return {
      configOptions: this._configOptions(sessionId),
      availableCommands: await this._availableCommands(st.cwd),
    };
  }

  async _replayFromStore(sessionId) {
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
        if (entry.thoughts.length) {
          this._update(sessionId, {
            sessionUpdate: "agent_thought",
            messageId: `msg_thought_r${agentN}`,
            content: entry.thoughts.map((t) => ({ type: "text", text: t })),
          });
        }
        for (const tool of entry.tools) {
          this._update(sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: `tool_r_${tool.callId ?? uuid().slice(0, 8)}`,
            name: tool.tool,
            title: deriveToolTitle(tool.tool, tool.input),
            kind: toolNameToKind(tool.tool),
            status: mapToolStatus(tool.status),
            ...(tool.input !== undefined ? { rawInput: tool.input } : {}),
            ...(tool.output !== undefined && tool.output !== null ? { rawOutput: tool.output } : {}),
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

  async list({ cwd }) {
    if (!cwd) return { sessions: [] };
    const sessions = await this._listSessions(cwd);
    // 本连接内创建但尚无 zcode ID 的会话也一并列出（恢复体验完整）
    for (const [sessionId, st] of this.sessions) {
      if (sessionId.startsWith("acp_") && st.cwd === cwd && !st.zcodeId) {
        sessions.unshift({ sessionId, cwd: st.cwd });
      }
    }
    return { sessions };
  }

  async close(sessionId) {
    const st = this._state(sessionId);
    if (st.running) await this.cancel(sessionId);
    st.closed = true;
    this.sessions.delete(sessionId);
    return {};
  }

  async setConfigOption({ sessionId, configId, value }) {
    if (configId !== "zcode.mode") {
      throw Object.assign(new Error(`unknown config option: ${configId}`), { code: -32602 });
    }
    const mode = value?.value ?? value;
    if (!MODE_VALUES.includes(mode)) {
      throw Object.assign(new Error(`invalid mode: ${mode}`), { code: -32602 });
    }
    this._state(sessionId).mode = mode;
    await this._refreshCommands(sessionId);
    return { configOptions: this._configOptions(sessionId) };
  }

  // ---------- 辅助 ----------

  _configOptions(sessionId) {
    const st = this._state(sessionId);
    return [
      {
        configId: "zcode.mode",
        name: "Permission Mode",
        description:
          "zcode --mode for turns. Headless has no permission client: yolo auto-approves; build/edit/guarded block write tools on confirmation; plan stays read-only.",
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
  }

  _emitUsage(sessionId, usage, projection) {
    const total = usage?.totalTokens ?? usage?.totalTokenCount ?? projection?.totalTokenCount;
    const size = projection?.contextWindow;
    if (typeof total !== "number") return;
    this._update(sessionId, {
      sessionUpdate: "usage_update",
      used: total,
      ...(typeof size === "number" ? { size } : {}),
    });
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
