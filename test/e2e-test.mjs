#!/usr/bin/env node
// 端到端测试：模拟 ACP v2 客户端驱动无头适配器全流程：
// initialize → session/new → prompt（对话 + 工具执行）→ session/list（sqlite 支撑）
// → session/resume（zcode 原生 ID + replayFrom 历史回放）→ session/cancel → session/close。
// 运行：node test/e2e-test.mjs [--quick]（需要 zcode CLI 已登录）
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = process.argv[2] ?? path.join(ROOT, "bin", "zcode-acp.mjs");
const QUICK = process.argv.includes("--quick");

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-acp-test-"));
fs.writeFileSync(path.join(workdir, "hello.txt"), "hello from zcode-acp test\n");

const child = spawn(process.execPath, [ENTRY], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, ZCODE_ACP_LOG: "/tmp/zcode-acp-test.log" },
});

let buf = "";
let nextId = 1;
const pending = new Map();
const updates = [];
const permGrants = []; // 已自动放行的权限请求（默认 build 模式下写工具会触发）

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params: params ?? {} });
  });
}
function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.error ? p.reject(makeErr(msg.error)) : p.resolve(msg.result);
      }
    } else if (msg.method === "session/update") {
      updates.push(msg.params);
      process.stdout.write(".");
    } else if (msg.method === "session/request_permission") {
      // 默认 build 模式下写/命令工具触发权限审批：本套件聚焦工具执行链路，自动放行一次
      const allow = (msg.params?.options ?? []).find((o) => o.kind === "allow_once") ?? msg.params?.options?.[0];
      permGrants.push(msg.params);
      send({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "selected", optionId: allow?.optionId ?? "allow" } } });
    }
  }
});

function makeErr(error) {
  const e = new Error(error.message);
  e.code = error.code;
  e.data = error.data;
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate, timeoutMs, what) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${what}`);
}

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`\nPASS ${name}`);
  else {
    console.log(`\nFAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

function updatesOf(sessionId, sessionUpdate) {
  return updates.filter((u) => u.sessionId === sessionId && u.update?.sessionUpdate === sessionUpdate);
}

async function main() {
  console.log(`workdir: ${workdir}`);

  // 1. initialize
  let r = await request("initialize", {
    protocolVersion: 2,
    capabilities: {},
    info: { name: "e2e-test", title: "E2E Test", version: "0.0.1" },
  });
  check("initialize 协商 v2", r.protocolVersion === 2);
  check("initialize 声明 session 能力", !!r.capabilities?.session);
  notify("notifications/initialized");

  // 2. session/new
  r = await request("session/new", { cwd: workdir });
  const sid = r.sessionId;
  check("session/new 返回 sessionId", typeof sid === "string" && sid.length > 0, JSON.stringify(r).slice(0, 200));
  check("session/new 返回 configOptions", Array.isArray(r.configOptions) && r.configOptions.some((o) => o.configId === "zcode.mode"));
  const cmdNames = (r.availableCommands ?? []).map((c) => c.name);
  check("availableCommands 含 compact 与 skill", cmdNames.includes("compact") && cmdNames.includes("skill"), JSON.stringify(cmdNames));
  const optIds = (r.configOptions ?? []).map((o) => o.configId);
  const appserverBackend = (process.env.ZCODE_ACP_BACKEND ?? "appserver").trim().toLowerCase() !== "headless";
  check("configOptions 含 model 与 reasoning（仅 appserver 后端）", !appserverBackend || (optIds.includes("zcode.model") && optIds.includes("zcode.reasoning")), optIds.includes("zcode.model") && optIds.includes("zcode.reasoning"), JSON.stringify(optIds));
  const skillCmd = (r.availableCommands ?? []).find((c) => c.name === "skill");
  // 每个已加载技能一条独立命令（appserver 后端由服务端 skills list 提供；headless 无技能列表）
  check(
    appserverBackend ? "技能以独立命令出现在列表" : "无头后端仅内置命令",
    !appserverBackend || cmdNames.some((n) => n.includes(":")),
    JSON.stringify(cmdNames.slice(0, 8)),
  );
  check("/skill 描述保持简短", (skillCmd?.description ?? "").length <= 200 && !(skillCmd?.description ?? "").includes("browser-use"), skillCmd?.description?.slice(0, 120));

  // 3. 简单对话
  r = await request("session/prompt", {
    sessionId: sid,
    prompt: [{ type: "text", text: "Reply with exactly one word: PONG" }],
  });
  check("session/prompt 返回 messageId", typeof r.messageId === "string" && r.messageId.length > 0, JSON.stringify(r));
  await waitFor(
    () => updatesOf(sid, "state_update").some((u) => u.update.state === "idle"),
    90000,
    "首个 prompt 完成",
  );
  const agentText = updatesOf(sid, "agent_message")
    .map((u) => (u.update.content ?? []).map((c) => c.text ?? "").join(""))
    .join("");
  const chunkText = updatesOf(sid, "agent_message_chunk")
    .map((u) => u.update.content?.text ?? "")
    .join("");
  check("收到 agent 回复（整段或流式分块）且包含 PONG", /PONG/i.test(agentText + chunkText), `text=${JSON.stringify((agentText + chunkText).slice(0, 120))}`);
  check("收到 user_message", updatesOf(sid, "user_message").length >= 1);
  const idle = updatesOf(sid, "state_update").find((u) => u.update.state === "idle");
  check("idle 带 end_turn 停止原因", idle?.update?.stopReason === "end_turn", JSON.stringify(idle?.update));
  check("收到 usage_update", updatesOf(sid, "usage_update").length >= 1);

  if (QUICK) {
    await request("session/close", { sessionId: sid });
    console.log(failures.length ? `\n${failures.length} FAILURES` : "\nALL PASS (quick)");
    child.kill();
    process.exit(failures.length ? 1 : 0);
  }

  // 4. 多轮上下文（验证 --resume 链）
  updates.length = 0;
  await request("session/prompt", {
    sessionId: sid,
    prompt: [{ type: "text", text: "What was the exact word I asked you to reply with? One word only." }],
  });
  await waitFor(
    () => updatesOf(sid, "state_update").some((u) => u.update.state === "idle"),
    90000,
    "多轮 prompt 完成",
  );
  const turn2Text =
    updatesOf(sid, "agent_message").map((u) => (u.update.content ?? []).map((c) => c.text ?? "").join("")).join("") +
    updatesOf(sid, "agent_message_chunk").map((u) => u.update.content?.text ?? "").join("");
  check("多轮上下文保持（能回忆 PONG）", /PONG/i.test(turn2Text), `text=${JSON.stringify(turn2Text.slice(0, 160))}`);

  // 5. 工具执行（写文件）——独立会话避免上下文干扰；无头模式下结果体现在文件系统
  updates.length = 0;
  const toolSid = (await request("session/new", { cwd: workdir })).sessionId;
  await request("session/prompt", {
    sessionId: toolSid,
    prompt: [
      {
        type: "text",
        text: "Use the Write tool (or Bash) to create a new file named out.txt in the current directory containing exactly the text: written-by-agent. You must actually create the file on disk. Then reply DONE.",
      },
    ],
  });
  await waitFor(
    () => updatesOf(toolSid, "state_update").some((u) => u.update.state === "idle"),
    120000,
    "工具 prompt 完成",
  );
  check("工具真实执行（文件已创建）", fs.existsSync(path.join(workdir, "out.txt")));
  if (appserverBackend) {
    check("默认 build 模式下写工具经权限审批（骨架已自动放行）", permGrants.length >= 1, `permGrants=${permGrants.length}`);
  }

  // 6. session/list（sqlite 支撑，包含本会话的 zcode 真实 ID）
  r = await request("session/list", { cwd: workdir });
  const listedIds = (r.sessions ?? []).map((s) => s.sessionId);
  check("session/list 返回会话列表", listedIds.length >= 1, JSON.stringify(r).slice(0, 300));
  const zcodeSessions = (r.sessions ?? []).filter((s) => s.sessionId.startsWith("sess_"));
  check("session/list 含 zcode 原生会话（含标题）", zcodeSessions.some((s) => s.title), JSON.stringify(zcodeSessions.slice(0, 2)));

  // 7. resume zcode 原生 ID + 历史回放
  updates.length = 0;
  const target = zcodeSessions[0]?.sessionId ?? listedIds[0];
  r = await request("session/resume", { sessionId: target, cwd: workdir, replayFrom: { type: "start" } });
  check("session/resume 成功", Array.isArray(r.configOptions), JSON.stringify(r).slice(0, 120));
  await sleep(300);
  check("回放包含历史 user_message", updatesOf(target, "user_message").length >= 1, `got ${updatesOf(target, "user_message").length}`);
  check("回放包含历史 agent_message", updatesOf(target, "agent_message").length >= 1, `got ${updatesOf(target, "agent_message").length}`);
  const lastUpdate = updates[updates.length - 1]?.update;
  check("resume 后有当前 idle state_update", lastUpdate?.sessionUpdate === "state_update" && lastUpdate.state === "idle");

  // 7b. resume 后继续对话（--resume 链恢复）
  updates.length = 0;
  await request("session/prompt", {
    sessionId: target,
    prompt: [{ type: "text", text: "Repeat the exact content of the file out.txt." }],
  });
  await waitFor(
    () => updatesOf(target, "state_update").some((u) => u.update.state === "idle"),
    90000,
    "resume 后 prompt 完成",
  );
  const resumedText =
    updatesOf(target, "agent_message").map((u) => (u.update.content ?? []).map((c) => c.text ?? "").join("")).join("") +
    updatesOf(target, "agent_message_chunk").map((u) => u.update.content?.text ?? "").join("");
  check("resume 后上下文有效（读出文件内容）", /written-by-agent/.test(resumedText), `text=${JSON.stringify(resumedText.slice(0, 160))}`);

  // 8. set_config_option 协议链路
  r = await request("session/set_config_option", {
    sessionId: target,
    configId: "zcode.mode",
    type: "id",
    value: "plan",
  });
  check("set_config_option 成功并回传配置", r && typeof r === "object" && Array.isArray(r.configOptions), JSON.stringify(r).slice(0, 120));
  let badErr = null;
  try {
    await request("session/set_config_option", { sessionId: target, configId: "zcode.nope", type: "id", value: "x" });
  } catch (e) {
    badErr = e;
  }
  check("set_config_option 非法项返回 -32602", badErr?.code === -32602, JSON.stringify(badErr));
  await request("session/set_config_option", { sessionId: target, configId: "zcode.mode", type: "id", value: "yolo" });

  // 8b. 斜杠命令：/skill 加载技能执行
  updates.length = 0;
  await request("session/prompt", {
    sessionId: target,
    prompt: [{ type: "text", text: "/skill command-pitfalls Reply with just: SKILL_OK" }],
  });
  await waitFor(
    () => updatesOf(target, "state_update").some((u) => u.update.state === "idle"),
    90000,
    "/skill 命令完成",
  );
  const skillText =
    updatesOf(target, "agent_message").map((u) => (u.update.content ?? []).map((c) => c.text ?? "").join("")).join("") +
    updatesOf(target, "agent_message_chunk").map((u) => u.update.content?.text ?? "").join("");
  check("/skill 斜杠命令执行成功", /SKILL_OK/i.test(skillText), `text=${JSON.stringify(skillText.slice(0, 160))}`);

  // 8c. 斜杠命令：/compact 压缩会话
  updates.length = 0;
  await request("session/prompt", {
    sessionId: target,
    prompt: [{ type: "text", text: "/compact" }],
  });
  await waitFor(
    () => updatesOf(target, "state_update").some((u) => u.update.state === "idle"),
    120000,
    "/compact 命令完成",
  );
  check(
    "/compact 斜杠命令执行（idle end_turn）",
    updatesOf(target, "state_update").some((u) => u.update.state === "idle" && u.update.stopReason === "end_turn"),
  );

  // 9. 取消
  updates.length = 0;
  await request("session/prompt", {
    sessionId: target,
    prompt: [{ type: "text", text: "Write a very long essay about the history of computing. At least 2000 words." }],
  });
  await waitFor(() => updatesOf(target, "state_update").some((u) => u.update.state === "running"), 15000, "running 状态");
  await request("session/cancel", { sessionId: target });
  await waitFor(
    () => updatesOf(target, "state_update").some((u) => u.update.state === "idle" && u.update.stopReason === "cancelled"),
    20000,
    "cancelled idle",
  );
  check("取消后 idle stopReason=cancelled", true);

  // 10. close
  r = await request("session/close", { sessionId: target });
  check("session/close 成功", JSON.stringify(r) === "{}");

  console.log(failures.length ? `\n${failures.length} FAILURES: ${failures.join(", ")}` : "\nALL PASS");
  child.kill();
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("\nTEST ERROR:", err.message, err.data ?? "");
  child.kill();
  process.exit(1);
});
