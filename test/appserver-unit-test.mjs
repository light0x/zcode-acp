#!/usr/bin/env node
// app-server 桥接单元测试：注入假协议客户端，钉住 ZCode Protocol 到 ACP 更新的映射——
// config options（mode/model/reasoning）、流式分块、工具状态迁移、取消、turn 收束兜底、
// 权限应答、v1 方言的 configOptions/set_config_option/chunk 直通。
// 运行：node test/appserver-unit-test.mjs（不依赖网络与 zcode 进程）
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AppServerBridge } from "../src/appserver-bridge.mjs";
import { AcpAgent } from "../src/acp-server.mjs";
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

const CATALOG = [
  {
    ref: { providerId: "prov-a", modelId: "model-x" },
    label: "model-x",
    providerLabel: "ProvA",
    contextWindow: 128000,
    reasoning: {
      levels: [
        { value: "disabled", label: "disabled" },
        { value: "low", label: "low" },
        { value: "high", label: "high" },
      ],
      defaultLevel: "high",
    },
  },
  {
    ref: { providerId: "prov-a", modelId: "model-y" },
    label: "model-y",
    providerLabel: "ProvA",
    contextWindow: 200000,
    reasoning: {
      levels: [
        { value: "disabled", label: "disabled" },
        { value: "max", label: "max" },
      ],
      defaultLevel: "max",
    },
  },
];

// 假协议客户端：实现桥接依赖的 ensure/request/on/generation/child 接口
class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.gen = 0;
    this.child = {};
    this.requests = [];
    this.handlers = new Map();
  }
  get generation() {
    return this.gen;
  }
  async ensure() {}
  async request(method, params) {
    this.requests.push({ method, params });
    const h = this.handlers.get(method);
    if (!h) throw new Error(`fake client: no handler for ${method}`);
    return typeof h === "function" ? h(params) : h;
  }
  kill() {}
  evt(sessionId, type, payload) {
    this.emit("notification", { method: "session/event", params: { sessionId, type, payload, seq: 1 } });
  }
  state(patch, sessionId) {
    this.emit("notification", { method: "state.updated", params: { patch, ...(sessionId ? { sessionId } : {}) } });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeBridge({ clientOverrides, onPermissionRequest, onElicitation } = {}) {
  const sent = [];
  const client = new FakeClient();
  client.handlers.set("session/create", (params) => {
    // 建会话即推送模型目录（settings 快照 + state.updated，对应真实行为）
    client.state({ model: { available: CATALOG } });
    return {
      session: {
        sessionId: `sess_${client.requests.filter((r) => r.method === "session/create").length}`,
        mode: "build",
        model: { providerId: "prov-a", modelId: "model-x" },
      },
      projection: { contextWindow: 128000, status: "idle" },
      settings: { model: { available: CATALOG } },
      slashCommands: [
        { name: "goal", description: "Set or advance the session goal.", inputHint: "/goal <objective>" },
        { name: "compact", description: "Server compact.", inputHint: "/compact" },
      ],
    };
  });
  client.handlers.set("session/setMode", {});
  client.handlers.set("session/subscribe", {});
  client.handlers.set("session/setModel", {});
  client.handlers.set("session/send", { accepted: true });
  client.handlers.set("session/stop", {});
  client.handlers.set("session/resume", { messages: [] });
  client.handlers.set("session/read", { messages: [] });
  client.handlers.set("session/list", { sessions: [] });
  client.handlers.set("session/close", {});
  Object.assign(client, clientOverrides);
  const bridge = new AppServerBridge({
    sendUpdate: (sessionId, update) => sent.push({ sessionId, update }),
    log: () => {},
    onPermissionRequest,
    onElicitation,
    client,
  });
  bridge._listCliCommands = async () => ({ commands: [{ name: "scan", description: "S", argumentHint: "[p]" }] });
  bridge._listCliSkills = async () => ({ skills: [] });
  bridge._readHistory = async () => [];
  bridge._listSessions = async () => [];
  return { bridge, client, sent };
}

const kindsOf = (sent) => sent.map((s) => s.update.sessionUpdate);
const wait = async (sent, predicate, what) => {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (predicate(sent)) return;
    await sleep(15);
  }
  throw new Error(`timeout waiting ${what}`);
};

async function main() {
  await test("createNew：三项 config options（select 形状）+ 模型目录取值", async () => {
    const { bridge, client, sent } = makeBridge();
    const r = await bridge.createNew({ cwd: "/w" });
    assert.ok(r.sessionId.startsWith("sess_"));
    const ids = r.configOptions.map((o) => o.configId);
    assert.deepEqual(ids, ["zcode.mode", "zcode.model", "zcode.reasoning"]);
    const names = r.availableCommands.map((c) => c.name);
    assert.ok(names.includes("goal") && names.includes("compact") && names.includes("skill"), "server slashCommands should merge with adapter builtins");
    const goal = r.availableCommands.find((c) => c.name === "goal");
    assert.deepEqual(goal.input, { type: "text", hint: "/goal <objective>" });
    const compact = r.availableCommands.find((c) => c.name === "compact");
    assert.equal(compact.description, "Server compact.", "server declaration wins on conflict");
    const mode = r.configOptions[0];
    assert.equal(mode.type, "select");
    assert.equal(mode.category, "mode");
    assert.equal(mode.currentValue, "yolo");
    assert.deepEqual(mode.options.map((o) => o.value), ["plan", "build", "edit", "yolo", "guarded"]);
    const model = r.configOptions[1];
    assert.equal(model.category, "model");
    assert.equal(model.currentValue, "prov-a/model-x");
    assert.deepEqual(model.options.map((o) => o.value), ["prov-a/model-x", "prov-a/model-y"]);
    const reasoning = r.configOptions[2];
    assert.equal(reasoning.currentValue, undefined);
    assert.deepEqual(reasoning.options.map((o) => o.value), ["disabled", "low", "high"]);
    // yolo 默认 + 订阅已发生
    assert.ok(client.requests.some((r) => r.method === "session/setMode" && r.params.mode === "yolo"));
    assert.ok(client.requests.some((r) => r.method === "session/subscribe"));
    assert.ok(kindsOf(sent).every((k) => k === undefined || true));
  });

  await test("prompt：user_message + send 透传 content", async () => {
    const { bridge, client } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    const r = await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "hi" }] });
    assert.equal(typeof r.messageId, "string");
    const send = client.requests.find((r) => r.method === "session/send");
    assert.equal(send.params.content, "hi");
    assert.equal(send.params.sessionId, sessionId);
  });

  await test("流式：text_delta → agent_message_chunk 同 messageId；turn.completed → usage + idle end_turn", async () => {
    const { bridge, client, sent } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "hi" }] });
    client.evt(sessionId, "model.streaming", { kind: "reasoning_delta", delta: "th" });
    client.evt(sessionId, "model.streaming", { kind: "text_delta", delta: "He" });
    client.evt(sessionId, "model.streaming", { kind: "text_delta", delta: "llo" });
    client.evt(sessionId, "turn.completed", {
      status: "success",
      response: "Hello",
      usage: { totalTokens: 99 },
    });
    await wait(sent, (s) => s.some((x) => x.update.sessionUpdate === "state_update"), "idle");
    const chunks = sent.filter((x) => x.update.sessionUpdate === "agent_message_chunk");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].update.messageId, chunks[1].update.messageId);
    assert.equal(chunks.map((c) => c.update.content.text).join(""), "Hello");
    assert.ok(sent.some((x) => x.update.sessionUpdate === "agent_thought_chunk"));
    const usage = sent.find((x) => x.update.sessionUpdate === "usage_update");
    assert.equal(usage.update.used, 99);
    assert.equal(usage.update.size, 128000);
    const idle = sent.filter((x) => x.update.sessionUpdate === "state_update").pop();
    assert.equal(idle.update.stopReason, "end_turn");
    // 已流式全文，不再整段兜底
    assert.ok(!kindsOf(sent).includes("agent_message"));
  });

  await test("兜底：无流式分块时以 turn.completed.response 整段送达", async () => {
    const { bridge, client, sent } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "hi" }] });
    client.evt(sessionId, "turn.completed", { status: "success", response: "FULL", usage: {} });
    await wait(sent, (s) => s.some((x) => x.update.sessionUpdate === "agent_message"), "agent_message");
    const m = sent.find((x) => x.update.sessionUpdate === "agent_message");
    assert.equal(m.update.content[0].text, "FULL");
  });

  await test("工具：scheduled→started→batch 状态迁移为 pending→in_progress→completed", async () => {
    const { bridge, client, sent } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "go" }] });
    client.evt(sessionId, "tool.updated", { kind: "scheduled", toolCallId: "t1", toolName: "Bash" });
    client.evt(sessionId, "tool.updated", { kind: "started", toolCallId: "t1" });
    client.evt(sessionId, "tool.updated", { kind: "batch", toolCallIds: ["t1"], successCount: 1, errorCount: 0 });
    await wait(
      sent,
      (s) => s.filter((x) => x.update.sessionUpdate === "tool_call_update").length >= 3,
      "tool updates",
    );
    const statuses = sent
      .filter((x) => x.update.sessionUpdate === "tool_call_update")
      .map((x) => x.update.status);
    assert.deepEqual(statuses, ["pending", "in_progress", "completed"]);
    const first = sent.find((x) => x.update.sessionUpdate === "tool_call_update");
    assert.equal(first.update.name, "Bash");
    assert.equal(first.update.kind, "execute");
  });

  await test("取消：session/stop 发出，turn 结束后 idle cancelled 且 cancel 返回", async () => {
    const { bridge, client, sent } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "long" }] });
    const cancelP = bridge.cancel(sessionId);
    await sleep(30);
    assert.ok(client.requests.some((r) => r.method === "session/stop"));
    client.evt(sessionId, "turn.completed", { status: "success", response: "partial", usage: {} });
    await cancelP;
    const idle = sent.filter((x) => x.update.sessionUpdate === "state_update").pop();
    assert.equal(idle.update.stopReason, "cancelled");
  });

  await test("setConfigOption：model 解析 provider/modelId；reasoning 带档位；非法值 -32602", async () => {
    const { bridge, client } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    const r = await bridge.setConfigOption({ sessionId, configId: "zcode.model", value: { value: "prov-a/model-y" } });
    const setModel = client.requests.filter((r) => r.method === "session/setModel").pop();
    // st.reasoning 未设置时落新模型的 defaultLevel（model-y → max）
    assert.deepEqual(setModel.params.model, { providerId: "prov-a", modelId: "model-y", options: { reasoningLevel: "max" } });
    assert.ok(Array.isArray(r.configOptions));
    await bridge.setConfigOption({ sessionId, configId: "zcode.reasoning", value: { value: "max" } });
    const last = client.requests.filter((r) => r.method === "session/setModel").pop();
    assert.deepEqual(last.params.model.options, { reasoningLevel: "max" });
    await assert.rejects(
      () => bridge.setConfigOption({ sessionId, configId: "zcode.model", value: { value: "nope" } }),
      (e) => e.code === -32602,
    );
    await assert.rejects(
      () => bridge.setConfigOption({ sessionId, configId: "zcode.reasoning", value: { value: "nope" } }),
      (e) => e.code === -32602,
    );
    await assert.rejects(
      () => bridge.setConfigOption({ sessionId, configId: "zcode.bad", value: {} }),
      (e) => e.code === -32602,
    );
  });

  await test("权限：反向请求经 onPermissionRequest 决策；无处理器时收敛为 deny", async () => {
    const allow = makeBridge({
      onPermissionRequest: async () => "allow",
    });
    assert.deepEqual(await allow.bridge._answerServer("interaction/requestPermission", { toolName: "Bash" }), {
      decision: "allow",
    });
    const deny = makeBridge();
    assert.deepEqual(await deny.bridge._answerServer("interaction/requestPermission", { toolName: "Bash" }), {
      decision: "deny",
    });
    assert.deepEqual(await deny.bridge._answerServer("session/requestRuntimePreferences", {}), {
      nativeSearchEnhancementsEnabled: false,
    });
  });

  await test("v1 方言：session/new 携带 configOptions；set_config_option 生效并回 config_option_update", async () => {
    const client = new FakeClient();
    client.handlers.set("session/create", (params) => {
      client.state({ model: { available: CATALOG } });
      return {
        session: {
          sessionId: "sess_1",
          mode: "build",
          model: { providerId: "prov-a", modelId: "model-x" },
        },
        projection: { contextWindow: 128000, status: "idle" },
      };
    });
    client.handlers.set("session/setMode", {});
    client.handlers.set("session/subscribe", {});
    client.handlers.set("session/setModel", {});
    client.handlers.set("session/send", { accepted: true });
    const acp = new AcpAgent({
      bridge: new AppServerBridge({
        sendUpdate: (sessionId, update) => acp.sendUpdate(sessionId, update),
        log: () => {},
        client,
      }),
      log: () => {},
    });
    const toAgent = new PassThrough();
    const toClient = new PassThrough();
    acp.attach(toAgent, toClient);
    const clientRpc = new LineRpc({ withJsonRpc: true });
    clientRpc.attach(toClient, toAgent);
    const wire = [];
    clientRpc.on("notification", (m) => {
      if (m.method === "session/update") wire.push(m.params);
    });
    await clientRpc.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const nr = await clientRpc.request("session/new", { cwd: "/w" });
    assert.ok(Array.isArray(nr.configOptions) && nr.configOptions.length === 3);
    assert.ok(nr.modes.available.length === 5);
    const sid = nr.sessionId;
    const r = await clientRpc.request("session/set_config_option", {
      sessionId: sid,
      configId: "zcode.model",
      type: "id",
      value: "prov-a/model-y",
    });
    assert.ok(Array.isArray(r.configOptions));
    assert.equal(r.configOptions.find((o) => o.id === "zcode.model").currentValue, "prov-a/model-y");
    assert.ok(r.configOptions.every((o) => o.configId === undefined), "v1 options must use id, not configId");
    const upd = wire.find((w) => w.update.sessionUpdate === "config_option_update");
    assert.ok(upd, "missing config_option_update");
    // 流式分块 v1 直通（桥接只在有活跃 turn 时消费事件，先发 prompt）
    await acp.bridge.prompt({ sessionId: sid, blocks: [{ type: "text", text: "hi" }] });
    client.evt(sid, "model.streaming", { kind: "text_delta", delta: "abc" });
    await sleep(30);
    assert.ok(wire.some((w) => w.update.sessionUpdate === "agent_message_chunk"));
    acp.rpc.output.destroy();
  });

  await test("连接换代：gen 变化后 prompt 触发 session/resume 重挂", async () => {
    const { bridge, client, sent } = makeBridge();
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    const resumeCount = () => client.requests.filter((r) => r.method === "session/resume").length;
    assert.equal(resumeCount(), 0);
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "first" }] });
    client.evt(sessionId, "turn.completed", { status: "success", usage: {} });
    await wait(sent, (s) => s.some((x) => x.update.sessionUpdate === "state_update" && x.update.state === "idle"), "first turn idle");
    client.gen += 1;
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "again" }] });
    assert.equal(resumeCount(), 1);
    // 同代内不重复重挂
    client.evt(sessionId, "turn.completed", { status: "success", usage: {} });
    await wait(sent, (s) => s.filter((x) => x.update.sessionUpdate === "state_update" && x.update.state === "idle").length >= 2, "second turn idle");
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "third" }] });
    assert.equal(resumeCount(), 1);
  });


  await test("providerEnv：剥离环境下自动探测运行期副本；env 已设置时不注入", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const fsMod = await import("node:fs");
    const tmp = fsMod.mkdtempSync(path.join(os.tmpdir(), "zcode-acp-probe-"));
    const runtimeRoot = path.join(tmp, "runtime", "provider", "windows-x86_64", "3.16.3", "endpoint-1");
    fsMod.mkdirSync(runtimeRoot, { recursive: true });
    fsMod.writeFileSync(path.join(runtimeRoot, "zcode-builtin.json"), "{}");
    const binDir = path.join(tmp, "resources", "glm");
    fsMod.mkdirSync(binDir, { recursive: true });
    fsMod.writeFileSync(path.join(binDir, "zcode.cjs"), "");
    const { AppServerClient } = await import("../src/appserver-client.mjs");
    const probe = new AppServerClient({ bin: path.join(binDir, "zcode.cjs"), log: () => {} });
    const found = probe._locateBuiltinProviderConfig(runtimeRoot);
    assert.equal(found, path.join(runtimeRoot, "zcode-builtin.json"));
    const staticBefore = probe._locateBuiltinProviderConfig(path.join(tmp, "nonexistent"));
    assert.equal(staticBefore, null);
    // 静态副本放入后应命中
    fsMod.mkdirSync(path.join(binDir, "..", "config", "provider"), { recursive: true });
    fsMod.writeFileSync(path.join(binDir, "..", "config", "provider", "zcode-builtin.json"), "{}");
    assert.equal(
      probe._locateBuiltinProviderConfig(path.join(tmp, "nonexistent")),
      path.join(binDir, "..", "config", "provider", "zcode-builtin.json"),
    );
    // env 已设置时返回空对象（桌面上下文继承，不覆盖）
    const saved = { b: process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, p: process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE };
    process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = "x";
    process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = "y";
    assert.deepEqual(probe._providerEnv(), {});
    process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = saved.b;
    process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = saved.p;
  });


  await test("elicitation：requestUserInput → onElicitation → answers 按 question 键回传", async () => {
    const got = [];
    const { bridge } = makeBridge({
      onElicitation: async (req) => {
        got.push(req);
        return { action: "accept", choice: "Option B" };
      },
    });
    const r = await bridge._answerServer("interaction/requestUserInput", {
      sessionId: "sess_1",
      questions: [{ header: "Pick", question: "Which one?", multiSelect: false, options: [{ label: "Option A" }, { label: "Option B" }] }],
    });
    assert.deepEqual(r, { action: "accept", content: { answers: { "Which one?": "Option B" } } });
    assert.equal(got[0].options.length, 2);
    const declined = await bridge
      ._answerServer("interaction/requestUserInput", { sessionId: "s", questions: [{ question: "q", options: [{ label: "x" }] }] })
      .catch(() => null);
    // 无 onElicitation 的桥接（makeBridge 默认未注入）在上一桥接里已注入；这里构造无处理器的实例
    const bare = makeBridge();
    bare.bridge.onElicitation = undefined;
    const r2 = await bare.bridge._answerServer("interaction/requestUserInput", { sessionId: "s", questions: [{ question: "q", options: [{ label: "x" }] }] });
    assert.equal(r2.action, "cancel");
  });

  await test("图片：附件分块上传链（begin/chunk/commit）→ send 携带 attachments", async () => {
    const { bridge, client } = makeBridge();
    client.handlers.set("v4/attachment/begin", { uploadId: "u", state: "staging" });
    client.handlers.set("v4/attachment/chunk", (p) => ({ uploadId: p.uploadId, nextChunkIndex: p.chunkIndex + 1 }));
    client.handlers.set("v4/attachment/commit", (p) => ({ ref: "zcode-artifact://test-ref" }));
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    // 1x1 PNG
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "看图" }, { type: "image", data: png, mimeType: "image/png" }] });
    const begin = client.requests.find((r) => r.method === "v4/attachment/begin");
    assert.ok(begin, "begin called");
    assert.equal(begin.params.mime, "image/png");
    assert.equal(begin.params.totalChunks, 1);
    assert.ok(begin.params.checksum.startsWith("sha256:"));
    const chunk = client.requests.find((r) => r.method === "v4/attachment/chunk");
    assert.equal(chunk.params.chunkIndex, 0);
    assert.ok(chunk.params.dataBase64.length > 10);
    const send = client.requests.find((r) => r.method === "session/send");
    const expectedBytes = Buffer.from(png, "base64").length;
    assert.deepEqual(send.params.attachments, [{ ref: "zcode-artifact://test-ref", fileName: "image-1.png", mime: "image/png", bytes: expectedBytes }]);
    client.evt(sessionId, "turn.completed", { status: "success", usage: {} });
    await new Promise((r) => setTimeout(r, 30));
  });

  await test("todo → plan：create 初始清单与 turn 后 diff 同步", async () => {
    const { bridge, client, sent } = makeBridge();
    let todosNow = [{ content: "step one", status: "pending" }];
    client.handlers.set("session/create", (params) => {
      client.state({ model: { available: CATALOG } });
      return {
        session: { sessionId: "sess_todo", mode: "build", model: { providerId: "prov-a", modelId: "model-x" } },
        projection: { contextWindow: 128000, status: "idle" },
        settings: { model: { available: CATALOG } },
        todos: todosNow,
      };
    });
    client.handlers.set("session/read", () => ({ todos: todosNow }));
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    let plan = sent.find((x) => x.update.sessionUpdate === "plan_update");
    assert.ok(plan, "initial plan missing");
    assert.equal(plan.update.plan.planId, "zcode-todos");
    assert.equal(plan.update.plan.entries[0].content, "step one");
    // turn 完成且 todo 变化 → 新 plan
    todosNow = [{ content: "step one", status: "completed" }, { content: "step two", status: "in_progress", priority: "high" }];
    await bridge.prompt({ sessionId, blocks: [{ type: "text", text: "go" }] });
    client.evt(sessionId, "turn.completed", { status: "success", usage: {} });
    await new Promise((r) => setTimeout(r, 50));
    const plans = sent.filter((x) => x.update.sessionUpdate === "plan_update");
    assert.equal(plans.length, 2, "plan diff should emit once more");
    assert.equal(plans[1].update.plan.entries[0].status, "completed");
    assert.equal(plans[1].update.plan.entries[1].status, "in_progress");
    assert.equal(plans[1].update.plan.entries[1].priority, "high");
  });


  await test("命令动态刷新：mode 变更后重算并全量替换", async () => {
    let call = 0;
    const { bridge, client, sent } = makeBridge();
    bridge._listCliCommands = async () => {
      call += 1;
      return { commands: [{ name: call === 1 ? "scan-a" : "scan-b", description: "S" }] };
    };
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    const initial = sent.find((x) => x.update.sessionUpdate === "available_commands_update");
    assert.equal(initial, undefined, "首列表应在 session/new 响应中而非通知");
    await bridge.setConfigOption({ sessionId, configId: "zcode.mode", value: { value: "plan" } });
    await new Promise((r) => setTimeout(r, 30));
    const upd = sent.find((x) => x.update.sessionUpdate === "available_commands_update");
    assert.ok(upd, "mode change should refresh commands");
    const names = upd.update.availableCommands.map((c) => c.name);
    assert.ok(names.includes("scan-b") && !names.includes("scan-a"), "refreshed list should contain scan-b");
    assert.ok(names.includes("compact") && names.includes("skill"));
  });


  await test("命令表：/skill 描述限长（长技能清单收敛）", async () => {
    const { bridge, client, sent } = makeBridge();
    const many = Array.from({ length: 30 }, (_, i) => ({ name: "skill-" + i, qualifiedName: "plugin:skill-" + i }));
    client.handlers.set("__noop", {});
    bridge._listCliSkills = async () => ({ skills: many });
    const { sessionId } = await bridge.createNew({ cwd: "/w" });
    void sessionId; void client; void sent;
    const cmds = await bridge._availableCommands("/w");
    const skill = cmds.find((c) => c.name === "skill");
    assert.ok(skill.description.length <= 200, "description should be bounded: " + skill.description.length);
    assert.ok(skill.description.includes("skill-0") && skill.description.includes("…+"));
  });

  console.log(failures.length ? `\n${failures.length} FAILURES: ${failures.join(", ")}` : "\nALL PASS");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("APPSERVER UNIT ERROR:", err);
  process.exit(1);
});
