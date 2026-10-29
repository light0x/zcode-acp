#!/usr/bin/env node
// 单元测试：无头桥接的会话生命周期、turn 队列、取消、resume 回放与配置选项。
// 通过实例注入替身（_runPrompt/_listSessions/_getSession/_readHistory），不依赖网络与 zcode 进程。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SessionBridge } from "../src/bridge.mjs";
import { zcodeCommand, resolveZcodeBin } from "../src/zcode-headless.mjs";
import { splitPromptBlocks, toolNameToKind, toolStateToStatus, deriveToolTitle, toolResultText, toolResultDiffBlocks } from "../src/content.mjs";

const failures = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((err) => {
      console.log(`FAIL ${name} — ${err.message}`);
      failures.push(name);
    });
}

const fakeProc = { kill() {} };

function makeBridge(overrides = {}) {
  const sent = [];
  const calls = { prompts: [] };
  const bridge = new SessionBridge({
    sendUpdate: (sessionId, update) => sent.push({ sessionId, update }),
    log: () => {},
  });
  bridge._runPrompt =
    overrides.runPrompt ??
    ((args) => {
      calls.prompts.push(args);
      return {
        proc: fakeProc,
        done: Promise.resolve({
          sessionId: "sess_generated_1",
          response: `echo:${args.text}`,
          usage: { totalTokens: 42 },
          projection: { contextWindow: 200000, totalTokenCount: 42 },
        }),
      };
    });
  bridge._listSessions =
    overrides.listSessions ??
    (async () => [{ sessionId: "sess_z1", cwd: "/w", title: "T1", updatedAt: "2026-01-01T00:00:00.000Z" }]);
  bridge._getSession =
    overrides.getSession ?? (async (id) => (id === "sess_z1" ? { sessionId: id, cwd: "/w", title: "T1" } : null));
  bridge._readHistory = overrides.readHistory ?? (async () => []);
  bridge._listCliCommands =
    overrides.listCliCommands ??
    (async () => ({
      commands: [
        { name: "mimosa-scan", description: "Quick security scan", argumentHint: "[path]" },
        { name: "compact", description: "should be deduped against builtin" },
      ],
    }));
  bridge._listCliSkills =
    overrides.listCliSkills ??
    (async () => ({
      skills: [
        { name: "control-browser", qualifiedName: "browser-use:control-browser" },
        { name: "command-pitfalls" },
      ],
    }));
  return { bridge, sent, calls };
}

function waitIdle(sent) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (sent.some((s) => s.update.sessionUpdate === "state_update" && s.update.state === "idle")) return resolve();
      if (Date.now() - start > 3000) return reject(new Error("timeout waiting idle"));
      setTimeout(poll, 20);
    })();
  });
}

function waitQueue(bridge, sessionId) {
  const st = bridge._state(sessionId);
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (!st.running && st.queue.length === 0) return resolve();
      if (Date.now() - start > 3000) return reject(new Error("timeout waiting queue drain"));
      setTimeout(poll, 20);
    })();
  });
}

async function main() {
  await test("createNew：生成本地 acp_ 会话并返回 mode 配置项", async () => {
    const { bridge } = makeBridge();
    const r = await bridge.createNew({ cwd: "/w" });
    assert.ok(r.sessionId.startsWith("acp_"));
    assert.equal(r.configOptions[0].configId, "zcode.mode");
    assert.equal(r.configOptions[0].currentValue, "yolo");
  });

  await test("availableCommands：内置 + 自定义命令去重 + 技能拼入 /skill 描述", async () => {
    const { bridge } = makeBridge();
    const r = await bridge.createNew({ cwd: "/w" });
    const names = r.availableCommands.map((c) => c.name);
    assert.ok(names.includes("compact"));
    assert.ok(names.includes("skill"));
    assert.ok(names.includes("mimosa-scan"));
    // 与内置重名的自定义命令被去重（只保留一条 compact）
    assert.equal(names.filter((n) => n === "compact").length, 1);
    const skill = r.availableCommands.find((c) => c.name === "skill");
    // 每个已加载技能一条独立命令（qualifiedName），/skill 不再堆技能名
    assert.ok(names.includes("browser-use:control-browser") && names.includes("command-pitfalls"));
    assert.ok(!skill.description.includes("browser-use"), "/skill 描述应保持简短");
    const cb = r.availableCommands.find((c) => c.name === "browser-use:control-browser");
    assert.ok(cb, "missing individual skill command");
    assert.ok(cb.description.length <= 140);
    const scan = r.availableCommands.find((c) => c.name === "mimosa-scan");
    assert.equal(scan.input.hint, "[path]");
  });

  await test("availableCommands：清单查询失败时保留基线命令", async () => {
    const { bridge } = makeBridge({
      listCliCommands: async () => {
        throw new Error("cli failed");
      },
      listCliSkills: async () => {
        throw new Error("cli failed");
      },
    });
    const r = await bridge.createNew({ cwd: "/w" });
    assert.deepEqual(
      r.availableCommands.map((c) => c.name),
      ["compact", "skill"],
    );
  });

  await test("prompt：立即返回 messageId，turn 异步发 running→agent_message→idle", async () => {
    const { bridge, sent, calls } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    const r = await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "hi" }] });
    assert.equal(typeof r.messageId, "string");
    await waitIdle(sent);
    const kinds = sent.map((s) => s.update.sessionUpdate);
    assert.ok(kinds.includes("user_message"));
    const states = sent.filter((s) => s.update.sessionUpdate === "state_update").map((s) => s.update.state);
    assert.deepEqual(states, ["running", "idle"]);
    const agent = sent.find((s) => s.update.sessionUpdate === "agent_message");
    assert.equal(agent.update.content[0].text, "echo:hi");
    assert.equal(sent.find((s) => s.update.sessionUpdate === "usage_update").update.used, 42);
    assert.ok(!calls.prompts[0].resumeId);
    assert.equal(calls.prompts[0].mode, "yolo");
  });

  await test("多轮：第二个 turn 复用 zcode sessionId", async () => {
    const { bridge, calls } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "a" }] });
    await waitQueue(bridge, sessionId);
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "b" }] });
    await waitQueue(bridge, sessionId);
    assert.equal(calls.prompts.length, 2);
    assert.equal(calls.prompts[1].resumeId, "sess_generated_1");
  });

  await test("取消：终止 turn 后发 idle cancelled", async () => {
    const { bridge, sent } = makeBridge();
    let releaseTurn;
    bridge._runTurn = async (sessionId) => {
      const st = bridge._state(sessionId);
      st.running = { cancel: () => releaseTurn?.() };
      bridge.sendUpdate(sessionId, { sessionUpdate: "state_update", state: "running" });
      await new Promise((resolve) => {
        releaseTurn = resolve;
        setTimeout(resolve, 4000);
      });
      bridge.sendUpdate(sessionId, { sessionUpdate: "state_update", state: "idle", stopReason: "cancelled" });
      st.running = null;
      for (const w of st.cancelWaiters ?? []) w();
    };
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "x" }] });
    await new Promise((r) => setTimeout(r, 50));
    await bridge.cancel(sessionId);
    const idle = sent
      .filter((s) => s.update.sessionUpdate === "state_update")
      .find((s) => s.update.state === "idle");
    assert.equal(idle.update.stopReason, "cancelled");
  });

  await test("错误 turn：发 idle error 且带 error 载荷", async () => {
    const { bridge, sent } = makeBridge({
      runPrompt: () => ({ proc: fakeProc, done: Promise.reject({ code: -32603, message: "zcode crashed" }) }),
    });
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "x" }] });
    await waitIdle(sent);
    const idle = sent
      .filter((s) => s.update.sessionUpdate === "state_update")
      .find((s) => s.update.state === "idle");
    assert.equal(idle.update.stopReason, "error");
    assert.equal(idle.update.error.message, "zcode crashed");
  });

  await test("resume：zcode 原生 ID 经存储验证 + replayFrom 回放历史", async () => {
    const { bridge, sent } = makeBridge({
      readHistory: async () => [
        { role: "user", text: "q1" },
        {
          role: "assistant",
          texts: ["a1"],
          thoughts: ["thinking"],
          tools: [{ callId: "c1", tool: "Bash", status: "completed", input: { command: "ls" }, output: "f" }],
        },
      ],
    });
    const r = await bridge.resume({ sessionId: "sess_z1", cwd: "/w", replayFrom: { type: "start" } });
    assert.ok(Array.isArray(r.configOptions));
    const kinds = sent.map((s) => s.update.sessionUpdate);
    assert.ok(kinds.includes("user_message"));
    assert.ok(!kinds.includes("agent_thought"), "精简模式默认不回放思考");
    assert.ok(kinds.includes("tool_call_update"));
    assert.ok(kinds.includes("agent_message"));
    const last = sent[sent.length - 1].update;
    assert.equal(last.sessionUpdate, "state_update");
    assert.equal(last.state, "idle");
    const tool = sent.find((s) => s.update.sessionUpdate === "tool_call_update");
    assert.equal(tool.update.status, "completed");
    // 回放后 turn 应带 --resume
    await bridge.prompt({ sessionId: "sess_z1", blocks: [{ type: "text", text: "n" }] });
    await waitQueue(bridge, "sess_z1");
  });

  await test("resume：不存在的会话返回 -32602", async () => {
    const { bridge } = makeBridge();
    await assert.rejects(() => bridge.resume({ sessionId: "sess_missing" }), (err) => err.code === -32602);
  });

  await test("resume：不支持的自定义 replayFrom 类型返回 -32602", async () => {
    const { bridge } = makeBridge();
    await assert.rejects(
      () => bridge.resume({ sessionId: "sess_z1", replayFrom: { type: "_custom" } }),
      (err) => err.code === -32602,
    );
  });

  await test("list：返回存储会话并合并本地新会话", async () => {
    const { bridge } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    const r = await bridge.list({ cwd: "/w" });
    const ids = r.sessions.map((s) => s.sessionId);
    assert.ok(ids.includes("sess_z1"));
    assert.ok(ids.includes(sessionId));
    assert.equal(r.sessions.find((s) => s.sessionId === "sess_z1").title, "T1");
  });

  await test("setConfigOption：mode 切换作用于下一个 turn；非法值报 -32602", async () => {
    const { bridge, calls } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.setConfigOption({ sessionId, configId: "zcode.mode", value: { type: "id", value: "plan" } });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "x" }] });
    await waitQueue(bridge, sessionId);
    assert.equal(calls.prompts[0].mode, "plan");
    await assert.rejects(
      () => bridge.setConfigOption({ sessionId, configId: "zcode.bad", value: {} }),
      (err) => err.code === -32602,
    );
    await assert.rejects(
      () => bridge.setConfigOption({ sessionId, configId: "zcode.mode", value: { type: "id", value: "nope" } }),
      (err) => err.code === -32602,
    );
  });

  await test("close：清空会话状态", async () => {
    const { bridge } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "x" }] });
    await waitQueue(bridge, sessionId);
    await bridge.close(sessionId);
    assert.ok(!bridge.sessions.has(sessionId));
  });

  test("content：splitPromptBlocks 拆分文本与图片", () => {
    const r = splitPromptBlocks([
      { type: "text", text: "hello" },
      { type: "resource_link", uri: "file:///tmp/a.rs", name: "a.rs" },
      { type: "resource", resource: { uri: "file:///tmp/b.txt", text: "b-content" } },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      { type: "audio", data: "YXVkaW8=", mimeType: "audio/mpeg" },
    ]);
    assert.ok(r.text.includes("hello") && r.text.includes("b-content"));
    assert.ok(r.text.includes("[file: file:///tmp/a.rs (a.rs)]"), "不存在的本地文件回落文本提示");
    assert.equal(r.links.length, 1, "resource_link 原样带回供回显");
    assert.equal(r.media.length, 2);
    assert.equal(r.media[0].mimeType, "image/png");
    assert.deepEqual(r.media[1], { data: "YXVkaW8=", mimeType: "audio/mpeg" });
    assert.throws(() => splitPromptBlocks([{ type: "video" }]));
    assert.throws(() => splitPromptBlocks([{ type: "audio" }]));
    assert.equal(toolStateToStatus("running"), "in_progress");
    assert.equal(toolNameToKind("Bash"), "execute");
  });

  test("content：编辑标题带 old→new 摘要；命令标题保持裸命令", () => {
    const t1 = deriveToolTitle("Edit", { file_path: "/w/a.rs", old_string: "beta line two", new_string: "BETA line two" });
    assert.ok(t1.startsWith("Edit: /w/a.rs · "), "路径前缀保持原样");
    assert.ok(t1.includes("beta line two → BETA line two"));
    const t2 = deriveToolTitle("Edit", { file_path: "/w/a.rs", old_string: "gamma three", new_string: "GAMMA three" });
    assert.notEqual(t1, t2, "同文件多处编辑的标题应可区分");
    assert.ok(!deriveToolTitle("Edit", { file_path: "/w/a.rs" }).includes("→"), "无 old/new 时不加摘要");
    assert.ok(!deriveToolTitle("Write", { file_path: "/w/a.rs", content: "x" }).includes("→"));
    assert.equal(deriveToolTitle("Bash", { command: "ls -la" }), "ls -la");
    const long = deriveToolTitle("Edit", { file_path: "/w/a.rs", old_string: "x".repeat(60), new_string: "" });
    assert.ok(long.length < 120, "摘要双侧限长，标题不失控");
  });

  test("content：工具结果归一为文本，structuredPatch 转 v2 diff 内容块", () => {
    assert.equal(toolResultText({ content: "done", perf: {} }), "done", "content 文本优先");
    assert.equal(toolResultText({ data: 1 }), '{"data":1}', "无 content 回退 JSON");
    assert.equal(toolResultText("raw"), "raw");
    assert.equal(toolResultText(undefined), undefined);
    assert.equal(toolResultText(null), undefined);
    const blocks = toolResultDiffBlocks({
      display: {
        filePath: "/w/a.rs",
        structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" alpha", "-beta", "+BETA", " gamma"] }],
      },
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "diff");
    assert.deepEqual(blocks[0].changes, [{ operation: "modify", path: "/w/a.rs", fileType: "text" }]);
    assert.equal(blocks[0].patch.format, "git_patch");
    assert.ok(blocks[0].patch.text.includes("@@ -1,3 +1,3 @@"));
    assert.ok(blocks[0].patch.text.split("\n").some((l) => l === "-beta"), "hunk 行前缀保留");
    assert.deepEqual(toolResultDiffBlocks({ display: {} }), []);
    assert.deepEqual(toolResultDiffBlocks(undefined), []);
  });

  test("content：resource_link 本地文件解析为 files 条目（localPath 直挂）", () => {
    const p = path.join(os.tmpdir(), `zcode-acp-test-${Date.now()}.md`);
    fs.writeFileSync(p, "# hi");
    try {
      const r = splitPromptBlocks([
        { type: "text", text: "看这个" },
        { type: "resource_link", uri: pathToFileURL(p).href, name: "note.md" },
      ]);
      assert.equal(r.text, "看这个", "可解析的本地文件不产生文本提示");
      assert.equal(r.files.length, 1);
      assert.equal(r.files[0].path, p);
      assert.equal(r.files[0].name, "note.md");
      assert.equal(r.files[0].mimeType, "text/plain");
      assert.equal(r.files[0].size, 4);
      assert.equal(r.links.length, 1);
    } finally {
      fs.rmSync(p, { force: true });
    }
  });

  test("无头图片：image 块落临时文件并经 --attach 传给 runPrompt", async () => {
    const calls = [];
    const attachSeen = [];
    const fsMod = await import("node:fs");
    const { bridge, sent } = makeBridge({
      runPrompt: (args) => {
        calls.push(args);
        attachSeen.push(...(args.attachPaths ?? []));
        return { proc: fakeProc, done: Promise.resolve({ sessionId: "s1", response: "ok", usage: {} }) };
      },
    });
    const s1 = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId: s1.sessionId, blocks: [{ type: "text", text: "听" }, { type: "audio", data: "YXVkaW8=", mimeType: "audio/x-m4a" }] });
    await waitQueue(bridge, s1.sessionId);
    assert.equal(attachSeen.length, 1, "--attach path count");
    assert.ok(attachSeen[0].endsWith(".m4a"), "audio ext from mime: " + attachSeen[0]);
    assert.ok(fsMod.existsSync(attachSeen[0]) === false, "临时文件应在 turn 后清理");
    const userMsg = sent.find((x) => x.update.sessionUpdate === "user_message");
    assert.equal(userMsg.update.content.filter((c) => c.type === "audio").length, 1);
  });

  test("跨平台：zcodeCommand 把 cjs 入口映射为 node 执行，二进制直接执行", () => {
    const cjs = zcodeCommand("C:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs");
    assert.equal(cjs.command, process.execPath);
    assert.deepEqual(cjs.baseArgs, ["C:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs"]);
    const bin = zcodeCommand("/home/u/.zcode/server/bin/zcode");
    assert.equal(bin.command, "/home/u/.zcode/server/bin/zcode");
    assert.deepEqual(bin.baseArgs, []);
    const exe = zcodeCommand("zcode.exe");
    assert.equal(exe.command, "zcode.exe");
  });

  test("跨平台：ZCODE_BIN 显式指定优先于自动探测", () => {
    assert.equal(resolveZcodeBin("/opt/custom/zcode"), "/opt/custom/zcode");
    assert.equal(resolveZcodeBin("  /opt/trim/zcode  "), "/opt/trim/zcode");
  });


  await test("思考显示默认值：ZCODE_ACP_THINKING_DISPLAY=full 时新会话默认完整", async () => {
    const saved = process.env.ZCODE_ACP_THINKING_DISPLAY;
    process.env.ZCODE_ACP_THINKING_DISPLAY = "full";
    try {
      const { bridge } = makeBridge();
      const r = await bridge.createNew({ cwd: "/w" });
      assert.equal(r.configOptions.find((o) => o.configId === "zcode.thinking_display").currentValue, "full");
    } finally {
      if (saved === undefined) delete process.env.ZCODE_ACP_THINKING_DISPLAY;
      else process.env.ZCODE_ACP_THINKING_DISPLAY = saved;
    }
  });

  await test("无头流式：stream 事件转分块，无增量时整段兜底", async () => {
    const streaming = makeBridge({
      runPrompt: (args) => {
        args.onStreamEvent?.({ kind: "reasoning_delta", delta: "th" });
        args.onStreamEvent?.({ kind: "text_delta", delta: "PONG" });
        return { proc: fakeProc, done: Promise.resolve({ sessionId: "s1", response: "PONG", usage: {} }) };
      },
    });
    const s1 = await streaming.bridge.createNew({ cwd: "/w" });
    await streaming.bridge.prompt({ sessionId: s1.sessionId, blocks: [{ type: "text", text: "x" }] });
    await waitQueue(streaming.bridge, s1.sessionId);
    const chunks = streaming.sent.filter((x) => x.update.sessionUpdate === "agent_message_chunk");
    assert.equal(chunks.map((c) => c.update.content.text).join(""), "PONG");
    assert.ok(!streaming.sent.some((x) => x.update.sessionUpdate === "agent_thought_chunk"), "精简模式默认不出思考流");
    await streaming.bridge.setConfigOption({ sessionId: s1.sessionId, configId: "zcode.thinking_display", value: { value: "full" } });
    await streaming.bridge.prompt({ sessionId: s1.sessionId, blocks: [{ type: "text", text: "x" }] });
    await waitQueue(streaming.bridge, s1.sessionId);
    assert.ok(streaming.sent.some((x) => x.update.sessionUpdate === "agent_thought_chunk"), "切 full 后思考流出线");
    assert.ok(!streaming.sent.some((x) => x.update.sessionUpdate === "agent_message"), "已流式时不应整段兜底");
    const fallback = makeBridge({
      runPrompt: () => ({ proc: fakeProc, done: Promise.resolve({ sessionId: "s1", response: "FULL", usage: {} }) }),
    });
    const f1 = await fallback.bridge.createNew({ cwd: "/w" });
    await fallback.bridge.prompt({ sessionId: f1.sessionId, blocks: [{ type: "text", text: "x" }] });
    await waitQueue(fallback.bridge, f1.sessionId);
    const whole = fallback.sent.find((x) => x.update.sessionUpdate === "agent_message");
    assert.equal(whole.update.content[0].text, "FULL");
  });

  console.log(failures.length ? `\n${failures.length} FAILURES: ${failures.join(", ")}` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("UNIT TEST ERROR:", err);
  process.exit(1);
});
