#!/usr/bin/env node
// zcode-acp：ACP Agent，按 initialize 协商 v1/v2 方言（当前已发布的 Zed 只说 v1），
// 驱动 zcode app-server（常驻子进程：流式输出、模型/思考强度、权限交互、插件 MCP 全量可用）。
// ZCODE_ACP_BACKEND=headless 可回退到每 turn 一个 `zcode -p --json` 进程的无头模式。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { AcpAgent } from "../src/acp-server.mjs";
import { SessionBridge } from "../src/bridge.mjs";
import { AppServerBridge } from "../src/appserver-bridge.mjs";
import { zcodeCommand, zcodeDbPath } from "../src/zcode-headless.mjs";
import { rotatingAppend } from "../src/logging.mjs";
// Zed 配置示例（agents.json）：
//   [{"name":"ZCode","command":{"path":"node","args":["/path/to/zcode-acp/bin/zcode-acp.mjs"]}}]

// --self-check：安装脚本调用，校验本机环境（node 版本 / zcode 可执行 / 会话库可读），退出码 0/1。
if (process.argv.includes("--self-check")) {
  await selfCheck();
} else {
  main();
}

function main() {
  // 日志默认落 ~/.zcode/cli/log（不可写时兜底系统临时目录），5MB 轮转；env 可覆盖
  const logDir = (() => {
    const base = path.join(os.homedir(), ".zcode", "cli", "log");
    try {
      fs.mkdirSync(base, { recursive: true });
      return base;
    } catch {
      return os.tmpdir();
    }
  })();
  const logFile = process.env.ZCODE_ACP_LOG ?? path.join(logDir, "zcode-acp-adapter.log");
  const protocolLog = process.env.ZCODE_ACP_PROTOCOL_LOG ?? path.join(logDir, "zcode-acp-protocol.log");
  const log = (...args) => rotatingAppend(logFile, `[${new Date().toISOString()}] ${args.join(" ")}`);

  const backend = (process.env.ZCODE_ACP_BACKEND ?? "appserver").trim().toLowerCase();
  const bridge =
    backend === "headless"
      ? new SessionBridge({
          sendUpdate: (sessionId, update) => acp.sendUpdate(sessionId, update),
          log,
        })
      : new AppServerBridge({
          sendUpdate: (sessionId, update) => acp.sendUpdate(sessionId, update),
          log,
          protocolLog,
          onPermissionRequest: (req) => acp.requestPermission(req),
          onElicitation: (req) => acp.requestElicitation(req),
        });
  const acp = new AcpAgent({ bridge, log });
  acp.attach(process.stdin, process.stdout);
  if (typeof bridge.warmup === "function") bridge.warmup();
  // 适配器退出时清掉 app-server 子进程（其 stdin 关闭也会自退，此处兜底）
  process.on("exit", () => bridge.client?.kill?.());
}

async function selfCheck() {
  const problems = [];
  const [major] = process.versions.node.split(".").map(Number);
  console.log(`node: v${process.versions.node} (${process.platform}/${process.arch})`);
  if (major < 22) problems.push(`Node.js >= 22 required (built-in node:sqlite), got v${process.versions.node}`);

  const { resolveZcodeBin } = await import("../src/zcode-headless.mjs");
  const bin = resolveZcodeBin();
  const { command, baseArgs } = zcodeCommand(bin);
  const known = baseArgs.length > 0 || /^[\\/]|^zcode/.test(command);
  if (!known || command === "zcode" || command === "zcode.exe") {
    problems.push(`zcode not found (tried ZCODE_BIN, platform defaults, PATH)`);
  }
  console.log(`zcode bin: ${bin}`);

  // 实际拉起一次 zcode --version 确认可执行（cjs 入口时用当前 node）
  if (problems.length === 0) {
    const version = await Promise.race([
      new Promise((resolve, reject) => {
        const child = spawn(command, [...baseArgs, "--version"], { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.on("exit", (code) => (code === 0 ? resolve(out.trim().split("\n").pop() ?? "") : reject(new Error(`exit ${code}`))));
        child.on("error", reject);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]).then(
      (v) => {
        console.log(`zcode version: ${v}`);
        return v;
      },
      (err) => {
        problems.push(`zcode not runnable (${err.message}); run "zcode login" after installing it`);
        return null;
      },
    );
  }

  const db = zcodeDbPath();
  const dbOk = fs.existsSync(db);
  console.log(`session db: ${db}${dbOk ? "" : " (not found yet — created after first zcode run)"}`);
  if (!dbOk && problems.length === 0) {
    // 库不存在不阻断：首个会话产生后即可用，仅提示
  }

  if (problems.length) {
    for (const p of problems) console.error(`PROBLEM: ${p}`);
    process.exit(1);
  }
  console.log("self-check OK");
}
