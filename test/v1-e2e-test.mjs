#!/usr/bin/env node
// 端到端测试（v1）：以协议版本 1 客户端驱动无头适配器走真实 zcode turn：
// initialize（v1 结果形状）→ session/new（modes + available_commands_update）
// → session/prompt（挂起至 turn 结束，stopReason 收束）→ session/cancel。
// 运行：node test/v1-e2e-test.mjs（需要 zcode CLI 已登录）
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = process.argv[2] ?? path.join(ROOT, "bin", "zcode-acp.mjs");

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-acp-v1-test-"));

const child = spawn(process.execPath, [ENTRY], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, ZCODE_ACP_LOG: "/tmp/zcode-acp-v1-test.log" },
});

let buf = "";
let nextId = 1;
const pending = new Map();
const updates = [];

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
        msg.error
          ? p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }))
          : p.resolve(msg.result);
      }
    } else if (msg.method === "session/update") {
      updates.push(msg.params);
      process.stdout.write(".");
    }
  }
});

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
const variantsOf = (sessionUpdate) => updates.filter((u) => u.update?.sessionUpdate === sessionUpdate);

async function main() {
  console.log(`workdir: ${workdir}`);

  // 1. v1 initialize：结果应为 v1 形状
  const r = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    clientInfo: { name: "v1-e2e-test", version: "0.0.1" },
  });
  check("initialize 协商 v1", r.protocolVersion === 1, JSON.stringify(r).slice(0, 200));
  check("initialize 返回 agentCapabilities.loadSession", r.agentCapabilities?.loadSession === true);
  check("initialize 返回 agentInfo", typeof r.agentInfo?.name === "string");
  check("无 v2 形状字段（capabilities/info）", r.capabilities === undefined && r.info === undefined);

  // 2. session/new：v1 返回 modes，available_commands_update 通知先行
  const nr = await request("session/new", { cwd: workdir, mcpServers: [] });
  const sid = nr.sessionId;
  check("session/new 返回 sessionId 与 modes", typeof sid === "string" && nr.modes?.available?.length >= 1, JSON.stringify(nr).slice(0, 200));
  await waitFor(() => variantsOf("available_commands_update").length >= 1, 3000, "available_commands_update");

  // 3. prompt：请求挂起至 turn 结束，以 stopReason 应答；更新为 v1 分块
  updates.length = 0;
  const pr = await request("session/prompt", {
    sessionId: sid,
    prompt: [{ type: "text", text: "Reply with exactly one word: PONG" }],
  });
  check("session/prompt 以 stopReason 应答", pr?.stopReason === "end_turn", JSON.stringify(pr));
  const agentText = variantsOf("agent_message_chunk")
    .map((u) => u.update.content?.text ?? "")
    .join("");
  check("收到 agent_message_chunk 且包含 PONG", /PONG/i.test(agentText), `text=${JSON.stringify(agentText.slice(0, 120))}`);
  check("收到 user_message_chunk", variantsOf("user_message_chunk").length >= 1);
  check("state_update 不出线（v2 专属）", variantsOf("state_update").length === 0);

  // 4. cancel 链路：空闲会话直接应答
  const cr = await request("session/cancel", { sessionId: sid });
  check("session/cancel 应答", cr !== undefined);

  console.log(failures.length ? `\n${failures.length} FAILURES: ${failures.join(", ")}` : "\nALL PASS");
  child.kill();
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("\nTEST ERROR:", err.message, err.data ?? "");
  child.kill();
  process.exit(1);
});
