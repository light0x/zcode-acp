#!/usr/bin/env node
// ACP v1 方言协议测试：内存双工流驱动 AcpAgent + SessionBridge（假 zcode 进程），
// 覆盖版本协商、v1 会话生命周期、更新翻译（分块/tool_call 先建后更/state_update 抑制）、
// prompt 以 stopReason 收束、错误与取消映射、set_mode 与 available_commands_update。
// 运行：node test/v1-test.mjs（不依赖网络与 zcode 进程）
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { AcpAgent } from "../src/acp-server.mjs";
import { SessionBridge } from "../src/bridge.mjs";
import { LineRpc } from "../src/rpc.mjs";

const failures = [];
async function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((err) => {
      console.log(`FAIL ${name} — ${err.message}`);
      failures.push(name);
    });
}

const fakeProc = { kill() {} };

// 组装 agent + 假桥接 + 内存客户端；wire 收集全部 session/update 通知
function makeEnv({ runPrompt, readHistory, listSessions, getSession } = {}) {
  const bridge = new SessionBridge({
    sendUpdate: (s, u) => acp.sendUpdate(s, u),
    log: () => {},
  });
  const acp = new AcpAgent({ bridge, log: () => {} });
  const toAgent = new PassThrough();
  const toClient = new PassThrough();
  acp.attach(toAgent, toClient);
  const client = new LineRpc({ withJsonRpc: true });
  client.attach(toClient, toAgent);
  const wire = [];
  client.on("notification", (m) => {
    if (m.method === "session/update") wire.push(m.params);
  });

  bridge._runPrompt =
    runPrompt ??
    ((args) => ({
      proc: fakeProc,
      done: Promise.resolve({
        sessionId: "sess_generated_1",
        response: `echo:${args.text}`,
        usage: { totalTokens: 42 },
        projection: { contextWindow: 200000, totalTokenCount: 42 },
      }),
    }));
  bridge._listSessions =
    listSessions ?? (async () => [{ sessionId: "sess_z1", cwd: "/w", title: "T1" }]);
  bridge._getSession = getSession ?? (async (id) => (id === "sess_z1" ? { sessionId: id, cwd: "/w" } : null));
  bridge._readHistory = readHistory ?? (async () => []);
  bridge._listCliCommands = async () => ({ commands: [{ name: "scan", description: "S", argumentHint: "[p]" }] });
  bridge._listCliSkills = async () => ({ skills: [] });

  const variants = (sessionUpdate) => wire.filter((w) => w.update?.sessionUpdate === sessionUpdate);
  return { bridge, acp, client, wire, variants };
}

function withTimeout(promise, label, ms = 3000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

async function initV1(client, requested = 1) {
  const r = await withTimeout(
    client.request("initialize", { protocolVersion: requested, clientCapabilities: { fs: {} }, clientInfo: { name: "t" } }),
    "initialize",
  );
  return r;
}

async function main() {
  await test("协商：v1 客户端得到 v1 结果（agentCapabilities/agentInfo）", async () => {
    const { client } = makeEnv();
    const r = await initV1(client, 1);
    assert.equal(r.protocolVersion, 1);
    assert.equal(r.agentCapabilities.loadSession, true);
    assert.deepEqual(r.agentCapabilities.promptCapabilities, { image: true, audio: true, embeddedContext: false }, "音频上传链实测可用，与 image 同口径声明");
    assert.ok(r.agentInfo?.name === "zcode-acp" && typeof r.agentInfo.version === "string");
    assert.deepEqual(r.authMethods, []);
    assert.equal(r.capabilities, undefined);
  });

  await test("协商：v2 请求仍得 v2；请求 3 服务为 2", async () => {
    {
      const { acp, client } = makeEnv();
      const r = await withTimeout(client.request("initialize", { protocolVersion: 2, capabilities: {} }), "init2");
      assert.equal(r.protocolVersion, 2);
      assert.ok(r.capabilities?.session && r.info?.name === "zcode-acp");
      assert.deepEqual(r.capabilities.session.prompt, { image: {}, audio: {} }, "v2 音频能力与 image 同口径声明");
      assert.equal(r.agentCapabilities, undefined);
      acp.rpc.output.destroy();
    }
    {
      const { client } = makeEnv();
      const r = await initV1(client, 3);
      assert.equal(r.protocolVersion, 2);
    }
  });

  await test("session/new：响应先于命令通知，通知随后必达（input 去掉 type）", async () => {
    const { client, wire } = makeEnv();
    await initV1(client);
    const r = await withTimeout(client.request("session/new", { cwd: "/w", mcpServers: [] }), "session/new");
    assert.ok(r.sessionId.startsWith("acp_"));
    assert.equal(r.modes.currentModeId, "yolo");
    assert.ok(r.modes.available.some((m) => m.id === "plan" && typeof m.name === "string"));
    assert.ok(Array.isArray(r.configOptions) && r.configOptions.some((o) => o.id === "zcode.mode"));
    const display = r.configOptions.find((o) => o.id === "zcode.thinking_display");
    assert.ok(display, "v1 应携带思考显示开关");
    assert.equal(display.currentValue, "concise", "思考显示默认精简");
    assert.deepEqual(display.options.map((o) => o.value), ["concise", "full"]);
    // 响应到达时命令通知不得抢先（客户端未注册会话会丢弃）
    assert.equal(
      wire.some((w) => w.update?.sessionUpdate === "available_commands_update"),
      false,
      "available_commands_update raced ahead of session/new response",
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const cmd = wire.find((w) => w.update?.sessionUpdate === "available_commands_update");
    assert.ok(cmd, "missing available_commands_update");
    const scan = cmd.update.availableCommands.find((c) => c.name === "scan");
    assert.deepEqual(scan.input, { hint: "[p]" });
  });

  await test("session/prompt：应答 {stopReason:'end_turn'}；更新为分块且无 state_update 出线", async () => {
    const { client, wire, variants } = makeEnv();
    await initV1(client);
    const { sessionId } = await withTimeout(client.request("session/new", { cwd: "/w" }), "new");
    wire.length = 0;
    const r = await withTimeout(
      client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "hi" }] }),
      "prompt",
      4000,
    );
    assert.deepEqual(r, { stopReason: "end_turn" });
    const kinds = wire.map((w) => w.update?.sessionUpdate);
    assert.ok(kinds.includes("user_message_chunk"), "missing user_message_chunk");
    assert.ok(kinds.includes("agent_message_chunk"), "missing agent_message_chunk");
    // 用户与代理文本均以单块送达，且代理分块先于应答前已在线上
    const agentChunk = variants("agent_message_chunk")[0];
    assert.equal(agentChunk.update.content.text, "echo:hi");
    assert.equal(agentChunk.update.content.type, "text");
    for (const v2only of ["user_message", "agent_message", "agent_thought", "state_update"]) {
      assert.equal(variants(v2only).length, 0, `v2-only variant leaked: ${v2only}`);
    }
  });

  await test("错误 turn：错误文本作为 agent_message_chunk 送达，stopReason 回退 end_turn", async () => {
    const { client, variants } = makeEnv({
      runPrompt: () => ({ proc: fakeProc, done: Promise.reject({ code: -32603, message: "boom" }) }),
    });
    await initV1(client);
    const { sessionId } = await withTimeout(client.request("session/new", { cwd: "/w" }), "new");
    const r = await withTimeout(
      client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "x" }] }),
      "prompt",
      4000,
    );
    assert.deepEqual(r, { stopReason: "end_turn" });
    const errChunk = variants("agent_message_chunk").find((w) => w.update.content.text.includes("boom"));
    assert.ok(errChunk, "missing error chunk");
  });

  await test("取消：session/cancel 后挂起的 prompt 以 stopReason 'cancelled' 收束", async () => {
    let rejectDone;
    const { client } = makeEnv({
      runPrompt: () => ({
        proc: fakeProc,
        done: new Promise((_, reject) => {
          rejectDone = reject;
        }),
        cancel: () => rejectDone({ cancelled: true }),
      }),
    });
    await initV1(client);
    const { sessionId } = await withTimeout(client.request("session/new", { cwd: "/w" }), "new");
    const promptP = withTimeout(
      client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "long" }] }),
      "prompt",
      4000,
    );
    await new Promise((r) => setTimeout(r, 80));
    await withTimeout(client.request("session/cancel", { sessionId }), "cancel");
    assert.deepEqual(await promptP, { stopReason: "cancelled" });
  });

  await test("session/load：回放（tool_call 先建后更）且应答携带 modes/configOptions，后续 turn 走 --resume", async () => {
    const calls = { prompts: [] };
    const { bridge, client, wire } = makeEnv({
      readHistory: async () => [
        { role: "user", text: "q1" },
        {
          role: "assistant",
          texts: ["a1"],
          thoughts: ["t1"],
          tools: [{ callId: "c1", tool: "Read", status: "completed", input: { path: "/w/a" }, output: { data: 1 } }],
        },
      ],
    });
    bridge._runPrompt = (args) => {
      calls.prompts.push(args);
      return {
        proc: fakeProc,
        done: Promise.resolve({ sessionId: "sess_generated_1", response: "ok", usage: {} }),
      };
    };
    await initV1(client);
    // 回放思考的出线受思考显示开关控制：切 full 后 load 回放包含思考块
    await withTimeout(
      client.request("session/set_config_option", { sessionId: "sess_z1", configId: "zcode.thinking_display", type: "id", value: "full" }),
      "set thinking display",
    );
    wire.length = 0;
    const r = await withTimeout(client.request("session/load", { sessionId: "sess_z1", cwd: "/w", mcpServers: [] }), "load");
    assert.equal(r.modes?.currentModeId, "yolo", "load 应答应携带 modes");
    assert.ok(r.configOptions?.some((o) => o.id === "zcode.mode"), "load 应答应携带 configOptions");
    const kinds = wire.map((w) => w.update?.sessionUpdate);
    assert.ok(kinds.includes("user_message_chunk") && kinds.includes("agent_thought_chunk"));
    const callIdx = kinds.indexOf("tool_call");
    const updateIdx = kinds.findIndex((k) => k === "tool_call_update");
    assert.ok(callIdx >= 0 && updateIdx > callIdx, "tool_call must precede tool_call_update");
    const call = wire[callIdx].update;
    assert.equal(call.kind, "read");
    assert.deepEqual(call.rawInput, { path: "/w/a" });
    assert.deepEqual(call.locations, [{ path: "/w/a" }], "文件目标应带 locations 供客户端点击打开");
    const contentUpdate = wire
      .filter((w) => w.update?.sessionUpdate === "tool_call_update")
      .find((w) => w.update.content);
    assert.equal(contentUpdate.update.content[0].content.text, '{"data":1}');
    // 回放会话继续对话：v1 prompt 收束且桥接带 --resume
    const pr = await withTimeout(
      client.request("session/prompt", { sessionId: "sess_z1", prompt: [{ type: "text", text: "n" }] }),
      "prompt",
      4000,
    );
    assert.deepEqual(pr, { stopReason: "end_turn" });
    assert.equal(calls.prompts[0].resumeId, "sess_z1");
  });

  await test("session/resume：不回放历史", async () => {
    const { client, wire } = makeEnv({
      readHistory: async () => [
        { role: "user", text: "q1" },
        { role: "assistant", texts: ["a1"], thoughts: [], tools: [] },
      ],
    });
    await initV1(client);
    const r = await withTimeout(client.request("session/resume", { sessionId: "sess_z1", cwd: "/w" }), "resume");
    assert.equal(r.modes?.currentModeId, "yolo", "resume 应答应携带 modes");
    assert.ok(r.configOptions?.some((o) => o.id === "zcode.mode"), "resume 应答应携带 configOptions");
    assert.equal(wire.filter((w) => w.update?.sessionUpdate?.endsWith("_chunk")).length, 0);
  });

  await test("session/set_mode：发 current_mode_update，且下一 turn 使用新模式", async () => {
    const calls = { prompts: [] };
    const env = makeEnv();
    env.bridge._runPrompt = (args) => {
      calls.prompts.push(args);
      return { proc: fakeProc, done: Promise.resolve({ sessionId: "s", response: "ok", usage: {} }) };
    };
    await initV1(env.client);
    const { sessionId } = await withTimeout(env.client.request("session/new", { cwd: "/w" }), "new");
    const r = await withTimeout(env.client.request("session/set_mode", { sessionId, modeId: "plan" }), "set_mode");
    assert.ok(Array.isArray(r.configOptions));
    const modeUpdate = env.variants("current_mode_update")[0];
    assert.equal(modeUpdate.update.currentModeId, "plan");
    await withTimeout(env.client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "x" }] }), "p", 4000);
    assert.equal(calls.prompts[0].mode, "plan");
  });

  await test("v1 未定义方法返回 -32601；未初始化连接返回 -32600", async () => {
    const { client, acp } = makeEnv();
    let err = null;
    try {
      await withTimeout(client.request("session/list", { cwd: "/w" }), "uninitialized");
    } catch (e) {
      err = e;
    }
    assert.equal(err?.code, -32600);
    await initV1(client);
    err = null;
    try {
      await withTimeout(client.request("bogus/method", {}), "v1-unsupported");
    } catch (e) {
      err = e;
    }
    assert.equal(err?.code, -32601);
    acp.rpc.output.destroy();
  });


  await test("session/list 与 session/close 路由 + 能力声明", async () => {
    const env = makeEnv();
    await initV1(env.client);
    const init = await withTimeout(env.client.request("initialize", { protocolVersion: 1 }), "re-init");
    const r = await withTimeout(env.client.request("session/list", { cwd: "/w" }), "list");
    assert.ok(Array.isArray(r.sessions) && r.sessions.some((x) => x.sessionId === "sess_z1"));
    const c = await withTimeout(env.client.request("session/close", { sessionId: "sess_z1" }), "close");
    assert.deepEqual(c, {});
  });

  await test("plan_update 在 v1 上翻译为 plan（无 planId）", async () => {
    const env = makeEnv();
    const acp = new AcpAgent({ bridge: env.bridge, log: () => {} });
    const toAgent = new PassThrough();
    const toClient = new PassThrough();
    acp.attach(toAgent, toClient);
    const client = new LineRpc({ withJsonRpc: true });
    client.attach(toClient, toAgent);
    const wire = [];
    client.on("notification", (m) => { if (m.method === "session/update") wire.push(m.params.update); });
    await client.request("initialize", { protocolVersion: 1 });
    const nr = await client.request("session/new", { cwd: "/w" });
    acp.sendUpdate(nr.sessionId, {
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "zcode-todos", entries: [{ content: "a", status: "pending" }] },
    });
    await new Promise((r) => setTimeout(r, 30));
    const plan = wire.find((u) => u.sessionUpdate === "plan");
    assert.ok(plan, "v1 plan missing");
    assert.equal(plan.entries[0].content, "a");
    assert.equal(plan.planId, undefined);
    acp.rpc.output.destroy();
  });

  await test("v1 diff 内容块：桥接 v2 diff 由 git_patch 文本还原 oldText/newText 随 create 送达，rawOutput 不重复", async () => {
    const env = makeEnv();
    const acp = new AcpAgent({ bridge: env.bridge, log: () => {} });
    const toAgent = new PassThrough();
    const toClient = new PassThrough();
    acp.attach(toAgent, toClient);
    const client = new LineRpc({ withJsonRpc: true });
    client.attach(toClient, toAgent);
    const wire = [];
    client.on("notification", (m) => { if (m.method === "session/update") wire.push(m.params.update); });
    await client.request("initialize", { protocolVersion: 1 });
    const nr = await client.request("session/new", { cwd: "/w" });
    acp.sendUpdate(nr.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "d1",
      name: "Edit",
      kind: "edit",
      status: "completed",
      title: "Edit: /w/a.rs",
      content: [{
        type: "diff",
        changes: [{ operation: "modify", path: "/w/a.rs", fileType: "text" }],
        patch: { format: "git_patch", text: "diff --git /w/a.rs /w/a.rs\n--- /w/a.rs\n+++ /w/a.rs\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma\n" },
      }],
      rawOutput: "The file /w/a.rs has been updated successfully.",
    });
    await new Promise((r) => setTimeout(r, 30));
    const create = wire.find((u) => u.sessionUpdate === "tool_call" && u.toolCallId === "d1");
    assert.ok(create, "首次更新应合成为 tool_call create");
    assert.equal(create.content?.length, 1, "diff 块应随 create 送达");
    assert.equal(create.content[0].type, "diff");
    assert.equal(create.content[0].path, "/w/a.rs");
    assert.equal(create.content[0].oldText, "alpha\nbeta\ngamma");
    assert.equal(create.content[0].newText, "alpha\nBETA\ngamma");
    const extra = wire.filter((u) => u.sessionUpdate === "tool_call_update" && u.toolCallId === "d1" && u.content);
    assert.equal(extra.length, 0, "diff 块已送达时 rawOutput 样板文本不应重复出线");
    acp.rpc.output.destroy();
  });

  console.log(failures.length ? `\n${failures.length} FAILURES: ${failures.join(", ")}` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("V1 TEST ERROR:", err);
  process.exit(1);
});
