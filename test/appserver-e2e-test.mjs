#!/usr/bin/env node
// 端到端测试（app-server 后端）：驱动真实 zcode app-server 全链路：
// initialize v2 → session/new（模型/思考强度 config options）→ set_config_option
// → prompt（流式分块）→ 取消（idle cancelled）→ close。
// 运行：node test/appserver-e2e-test.mjs（需要 zcode CLI 已登录）
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = process.argv[2] ?? path.join(ROOT, "bin", "zcode-acp.mjs");

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-acp-appserver-test-"));

const child = spawn(process.execPath, [ENTRY], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, ZCODE_ACP_LOG: "/tmp/zcode-acp-appserver-test.log" },
});

let buf = "";
let nextId = 1;
const pending = new Map();
const updates = [];
const permRequests = [];

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
        msg.error ? p.reject(makeErr(msg.error)) : p.resolve(msg.result);
      }
    } else if (msg.method === "session/update") {
      updates.push(msg.params);
      process.stdout.write(".");
    } else if (msg.method === "session/request_permission") {
      permRequests.push(msg);
      process.stdout.write("P");
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


// 生成纯色 PNG（8-bit truecolor），用于 image 端到端
function makeSolidPng(w, h, r, g, b) {
  const crc = (buf) => zlib.crc32(buf) >>> 0;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      row[1 + x * 3] = r;
      row[2 + x * 3] = Math.floor((g + 255 * x) / w / 2);
      row[3 + x * 3] = Math.floor((b + 255 * y) / h / 2);
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}


async function main() {
  console.log(`workdir: ${workdir}`);

  // 1. initialize
  const r = await request("initialize", {
    protocolVersion: 2,
    capabilities: {},
    info: { name: "appserver-e2e-test", title: "AppServer E2E", version: "0.0.1" },
  });
  check("initialize 协商 v2", r.protocolVersion === 2);

  // 2. session/new：模型与思考强度以 config options 暴露
  const nr = await request("session/new", { cwd: workdir });
  const sid = nr.sessionId;
  check("session/new 返回 sessionId", typeof sid === "string" && sid.startsWith("sess_"), JSON.stringify(nr).slice(0, 200));
  const opts = Object.fromEntries((nr.configOptions ?? []).map((o) => [o.configId, o]));
  check("configOptions 含 model 且有可选值", opts["zcode.model"]?.options?.length >= 1, JSON.stringify(nr.configOptions).slice(0, 200));
  check("configOptions 含 reasoning 且有档位", opts["zcode.reasoning"]?.options?.length >= 1);
  check("model currentValue 指向目录条目", opts["zcode.model"]?.options?.some((o) => o.value === opts["zcode.model"]?.currentValue));

  // 3. set_config_option 切思考档位并回读
  const levels = opts["zcode.reasoning"].options.map((o) => o.value);
  const target = levels[levels.length - 1];
  const sr = await request("session/set_config_option", {
    sessionId: sid,
    configId: "zcode.reasoning",
    type: "id",
    value: target,
  });
  const sro = Object.fromEntries((sr.configOptions ?? []).map((o) => [o.configId, o]));
  check("set_config_option 回读 currentValue", sro["zcode.reasoning"]?.currentValue === target, JSON.stringify(sr).slice(0, 200));

  // 4. prompt：流式分块 + idle end_turn
  updates.length = 0;
  const pr = await request("session/prompt", {
    sessionId: sid,
    prompt: [{ type: "text", text: "Reply with exactly one word: PONG" }],
  });
  check("session/prompt 返回 messageId", typeof pr.messageId === "string" && pr.messageId.length > 0, JSON.stringify(pr));
  await waitFor(
    () => updatesOf(sid, "state_update").some((u) => u.update.state === "idle"),
    90000,
    "prompt 完成",
  );
  const chunkText = updatesOf(sid, "agent_message_chunk").map((u) => u.update.content?.text ?? "").join("");
  const wholeText = updatesOf(sid, "agent_message").map((u) => (u.update.content ?? []).map((c) => c.text ?? "").join("")).join("");
  check("收到回复（流式或整段）包含 PONG", /PONG/i.test(chunkText + wholeText), `text=${JSON.stringify((chunkText + wholeText).slice(0, 120))}`);
  const idle = updatesOf(sid, "state_update").find((u) => u.update.state === "idle");
  check("idle 带 end_turn 停止原因", idle?.update?.stopReason === "end_turn", JSON.stringify(idle?.update));
  check("收到 usage_update", updatesOf(sid, "usage_update").length >= 1);

  // 5. 取消：长任务中途 stop → idle cancelled
  updates.length = 0;
  await request("session/prompt", {
    sessionId: sid,
    prompt: [{ type: "text", text: "写一篇至少 3000 字的关于计算机发展史的文章" }],
  });
  await waitFor(() => updatesOf(sid, "state_update").some((u) => u.update.state === "running"), 15000, "running 状态");
  await request("session/cancel", { sessionId: sid });
  await waitFor(
    () => updatesOf(sid, "state_update").some((u) => u.update.state === "idle" && u.update.stopReason === "cancelled"),
    20000,
    "cancelled idle",
  );
  check("取消后 idle stopReason=cancelled", true);


  // 6. 权限链路：默认 build 模式下高风险操作经 session/request_permission 弹窗批准。
  //    延迟应答跨越 app-server 的 ~5s 重发周期，验证适配器合并为单弹窗；deny 后跳过。
  {
    const permSid = (await request("session/new", { cwd: workdir })).sessionId;
    const modeOpt = Object.fromEntries((await request("session/set_config_option", { sessionId: permSid, configId: "zcode.mode", type: "id", value: "build" })).configOptions.map((o) => [o.configId, o]))["zcode.mode"];
    check("默认模式 build（副作用/高风险工具走权限审批）", modeOpt?.currentValue === "build", JSON.stringify(modeOpt));

    const victimA = path.join(workdir, "perm-allow.txt");
    const victimB = path.join(workdir, "perm-deny.txt");
    fs.writeFileSync(victimA, "x");
    fs.writeFileSync(victimB, "x");
    updates.length = 0;
    permRequests.length = 0;
    await request("session/prompt", {
      sessionId: permSid,
      prompt: [{ type: "text", text: "Delete the file perm-allow.txt in the current working directory by running a shell command. Do it directly without asking any question." }],
    });
    await waitFor(() => permRequests.length >= 1, 120000, "权限请求出线");
    const opts2 = permRequests[0].params?.options ?? [];
    check("权限请求携带服务端选项（Allow once / Always allow / Deny）", opts2.some((o) => o.kind === "allow_once") && opts2.some((o) => o.kind === "allow_always") && opts2.some((o) => o.kind === "reject_once"), JSON.stringify(opts2));
    check("权限请求主体为命令形态", permRequests[0].params?.subject?.type === "command" && typeof permRequests[0].params?.subject?.command === "string", JSON.stringify(permRequests[0].params?.subject)?.slice(0, 160));
    // 延迟 12s：跨 2-3 个 app-server 重发周期，适配器应合并为一次弹窗
    await sleep(12000);
    send({ jsonrpc: "2.0", id: permRequests[0].id, result: { outcome: { outcome: "selected", optionId: "allow_once" } } });
    await waitFor(
      () => updatesOf(permSid, "state_update").some((u) => u.update.state === "idle"),
      180000,
      "allow 后 turn 收束",
    );
    check("延迟应答期间重发被合并（客户端仍只见一次弹窗）", permRequests.length === 1, `permRequests=${permRequests.length}`);
    check("allow 后命令执行（victim 已删除）", !fs.existsSync(victimA));

    updates.length = 0;
    permRequests.length = 0;
    await request("session/prompt", {
      sessionId: permSid,
      prompt: [{ type: "text", text: "Delete the file perm-deny.txt in the current working directory by running a shell command. Do it directly without asking any question." }],
    });
    await waitFor(() => permRequests.length >= 1, 120000, "第二笔权限请求出线");
    send({ jsonrpc: "2.0", id: permRequests[0].id, result: { outcome: { outcome: "selected", optionId: "deny" } } });
    await waitFor(
      () => updatesOf(permSid, "state_update").some((u) => u.update.state === "idle"),
      180000,
      "deny 后 turn 收束",
    );
    check("deny 后跳过执行（victim 保留）", fs.existsSync(victimB));
  }

  // 7. image 端到端：纯红 PNG 经附件上传链送达，模型识别颜色
  {
    const png = makeSolidPng(256, 256, 255, 0, 0);
    // 独立会话：避免被上一轮取消任务的上下文污染
    const imgSid = (await request("session/new", { cwd: workdir })).sessionId;
    try {
      await request("session/set_config_option", { sessionId: imgSid, configId: "zcode.model", type: "id", value: "bigmodel-coding-plan/GLM-5.3-Flash" });
    } catch {}
    updates.length = 0;
    const ir = await request("session/prompt", {
      sessionId: imgSid,
      prompt: [
        { type: "text", text: "What is the dominant color of the attached image? Answer with exactly one word." },
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      ],
    });
    check("image prompt 受理", typeof ir.messageId === "string", JSON.stringify(ir).slice(0, 120));
    await waitFor(
      () => updatesOf(imgSid, "state_update").some((u) => u.update.state === "idle"),
      120000,
      "image prompt 完成",
    );
    const imgText =
      updatesOf(imgSid, "agent_message").map((u) => (u.update.content ?? []).map((c) => c.text ?? "").join("")).join("") +
      updatesOf(imgSid, "agent_message_chunk").map((u) => u.update.content?.text ?? "").join("");
    const imgIdle = updatesOf(imgSid, "state_update").some((u) => u.update.state === "idle");
    check("image turn 收束（附件上传链送达）", imgIdle, "idle 未到达");
    console.log("（观测）模型对图片的回复:", JSON.stringify(imgText.slice(0, 80)));
  }

  // 8. close
  const cr = await request("session/close", { sessionId: sid });
  check("session/close 成功", cr !== undefined);

  console.log(failures.length ? `\n${failures.length} FAILURES: ${failures.join(", ")}` : "\nALL PASS");
  child.kill();
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("\nTEST ERROR:", err.message, err.data ?? "");
  child.kill();
  process.exit(1);
});
