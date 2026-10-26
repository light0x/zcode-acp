// 无头 zcode 驱动层：
// 1. runPrompt —— spawn `zcode -p <text> --json`（每个 turn 一个进程），返回最终 JSON 结果；
// 2. 会话存储只读访问 —— 从 zcode 的 sqlite（session/message/part 表）读会话列表与历史，
//    支撑 ACP session/list 与 session/resume 历史回放。只读连接，不干扰 zcode 写入。
// 跨平台：Linux/macOS/WSL 用 ~/.zcode/server/bin/zcode；Windows 用桌面版内置的
// resources/glm/zcode.cjs（Node 脚本，与适配器共用同一个 node 运行时执行）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

// Windows 桌面版内置 CLI 的候选位置（按优先级）
const WINDOWS_CLI_CANDIDATES = [
  () => path.join(process.env.LOCALAPPDATA ?? "", "Programs", "ZCode", "resources", "glm", "zcode.cjs"),
  () => path.join(process.env.ProgramFiles ?? "C:\\Program Files", "ZCode", "resources", "glm", "zcode.cjs"),
];

export function resolveZcodeBin(explicit) {
  if (explicit && explicit.trim()) return explicit.trim();
  if (process.env.ZCODE_BIN && process.env.ZCODE_BIN.trim()) return process.env.ZCODE_BIN.trim();
  if (process.platform === "win32") {
    for (const candidate of WINDOWS_CLI_CANDIDATES) {
      const p = candidate();
      if (p && fs.existsSync(p)) return p;
    }
    return "zcode.exe";
  }
  const fallback = path.join(os.homedir(), ".zcode", "server", "bin", "zcode");
  if (fs.existsSync(fallback)) return fallback;
  return "zcode";
}

// 把 bin 解析为可执行的 { command, baseArgs }：
// - .cjs（Windows 桌面版内置 CLI 或任何 js 入口）→ 用当前 node 运行时执行；
// - 其他（原生可执行）→ 直接执行。
// 纯函数，便于测试。
export function zcodeCommand(bin) {
  if (typeof bin === "string" && /\.c?m?js$/i.test(bin)) {
    return { command: process.execPath, baseArgs: [bin] };
  }
  return { command: bin, baseArgs: [] };
}

export function zcodeDbPath() {
  return process.env.ZCODE_DB_PATH || path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");
}

// 运行一次无头 turn。返回 { proc, done, cancel }：
// done —— Promise<result>，result 为 `type:"result"` 结果行对象；进程被取消时 reject { cancelled: true }。
// onStreamEvent —— 可选，model.streaming 事件载荷回调（text_delta/reasoning_delta 流式增量）。
// attachPaths —— 可选，本地附件路径列表，经官方 --attach <path> 送达（可重复）。
// cancel —— 平台无关的取消（置标志 + kill）；Windows 上 kill 不可靠传递信号语义，以标志为准。
// 输出走官方 --output-format stream-json（NDJSON 逐行事件，type:"result" 收尾，见 usage/02-cli-reference.md）。
export function runPrompt({ bin, text, cwd, mode, resumeId, env, onStreamEvent, attachPaths }) {
  const { command, baseArgs } = zcodeCommand(bin);
  const args = [...baseArgs, "-p", text];
  for (const p of attachPaths ?? []) args.push("--attach", p);
  args.push("--output-format", "stream-json", "--cwd", cwd);
  if (mode) args.push("--mode", mode);
  if (resumeId) args.push("--resume", resumeId);
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", ...(env ?? {}) },
  });
  if (process.env.ZCODE_ACP_DEBUG_SPAWN) console.error(`[zcode-acp spawn] ${command} ${args.map((a) => JSON.stringify(a.slice(0, 60))).join(" ")}`);
  let stdout = "";
  let stderr = "";
  // stdout 只由下方 readline 逐行消费（line 事件里累积），避免同一流双重监听
  child.stderr.on("data", (d) => {
    const s = d.toString();
    if (!s.includes("ExperimentalWarning") && !s.includes("trace-warnings")) stderr += s;
  });
  const handle = { proc: child, cancelled: false };
  handle.cancel = () => {
    if (handle.cancelled || child.exitCode !== null) return;
    handle.cancelled = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 2500);
  };
  handle.done = new Promise((resolve, reject) => {
    let result = null;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const text = line.trim();
      if (!text) return;
      stdout += text + "\n";
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        return;
      }
      if (event.type === "result") {
        result = event;
        return;
      }
      if (event.type === "model.streaming" && onStreamEvent) {
        try {
          onStreamEvent(event.payload ?? {});
        } catch {}
      }
    });
    lines.on("close", () => {
      if (result) resolve(result);
    });
    child.on("exit", (code, signalName) => {
      lines.close();
      if (handle.cancelled || signalName === "SIGTERM" || signalName === "SIGKILL") {
        reject({ cancelled: true, stdout });
        return;
      }
      if (code !== 0) {
        reject({
          code: -32603,
          message: stderr.trim() || `zcode exited with code ${code}`,
          stdout,
        });
        return;
      }
      if (result) {
        resolve(result);
        return;
      }
      reject({ code: -32603, message: "zcode produced no result line", stdout, stderr });
    });
    child.on("error", (err) => reject({ code: -32603, message: err.message }));
  });
  return handle;
}

// ---------- 只读会话存储 ----------

let dbLazy = null;
let sqliteLoad = null;
async function openDb() {
  if (dbLazy !== null) return dbLazy;
  try {
    sqliteLoad ??= import("node:sqlite");
    const { DatabaseSync } = await sqliteLoad;
    const p = zcodeDbPath();
    if (!fs.existsSync(p)) {
      dbLazy = false;
      return false;
    }
    dbLazy = new DatabaseSync(p, { readOnly: true });
  } catch {
    dbLazy = false;
  }
  return dbLazy;
}

// ---------- CLI 清单查询（命令 / 技能，带 TTL 缓存） ----------

const LIST_TTL_MS = 5 * 60 * 1000;
const listCache = new Map(); // key -> { at, value }

async function cachedList(key, produce) {
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.value;
  const value = await produce().catch(() => null);
  listCache.set(key, { at: Date.now(), value });
  return value;
}

function runCliJson(bin, args, cwd) {
  const { command, baseArgs } = zcodeCommand(bin);
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...baseArgs, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
      ...(cwd ? { cwd } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      const s = d.toString();
      if (!s.includes("ExperimentalWarning") && !s.includes("trace-warnings")) stderr += s;
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `zcode ${args.join(" ")} exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(err);
      }
    });
    child.on("error", reject);
  });
}

// 自定义 / 插件斜杠命令（commands list --json）
export function listCliCommands(bin, cwd) {
  return cachedList(`commands:${bin}:${cwd ?? ""}`, () => runCliJson(bin, ["commands", "list", "--json"], cwd));
}

// 技能清单（skills list --json）
export function listCliSkills(bin, cwd) {
  return cachedList(`skills:${bin}:${cwd ?? ""}`, () => runCliJson(bin, ["skills", "list", "--json"], cwd));
}

// 列出某工作目录下的交互会话（跳过已删除与子代理会话）
export async function listSessions(cwd, limit = 50) {
  const db = await openDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT id, path, directory, title, time_updated FROM session
         WHERE time_deleted IS NULL AND task_type = 'interactive' AND (path = ? OR directory = ?)
         ORDER BY time_updated DESC LIMIT ?`,
      )
      .all(cwd, cwd, limit);
    return rows.map((r) => ({
      sessionId: String(r.id),
      cwd: r.path ?? r.directory ?? cwd,
      ...(r.title ? { title: r.title } : {}),
      updatedAt: new Date(r.time_updated).toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function getSession(sessionId) {
  const db = await openDb();
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT id, path, directory, title, time_updated, time_deleted, task_type FROM session WHERE id = ?`,
      )
      .get(sessionId);
    if (!row || row.time_deleted !== null) return null;
    return {
      sessionId: String(row.id),
      cwd: row.path ?? row.directory,
      ...(row.title ? { title: row.title } : {}),
      updatedAt: new Date(row.time_updated).toISOString(),
    };
  } catch {
    return null;
  }
}

// 读取会话历史，输出 [{ role, texts, thoughts, tools }]：
// role=user 仅保留真实用户输入（过滤 synthetic 注入），文本合并；
// assistant 的 reasoning 与 tool part 一并提取（回放用）。
export async function readHistory(sessionId, maxMessages = 400) {
  const db = await openDb();
  if (!db) return [];
  try {
    const msgs = db
      .prepare("SELECT id, sequence, data FROM message WHERE session_id = ? ORDER BY sequence LIMIT ?")
      .all(sessionId, maxMessages);
    const partsByMessage = new Map();
    const parts = db
      .prepare(
        "SELECT message_id, sequence, data FROM part WHERE session_id = ? ORDER BY message_id, sequence",
      )
      .all(sessionId);
    for (const p of parts) {
      if (!partsByMessage.has(p.message_id)) partsByMessage.set(p.message_id, []);
      partsByMessage.get(p.message_id).push(safeJson(p.data));
    }
    const out = [];
    for (const m of msgs) {
      const data = safeJson(m.data);
      if (!data || typeof data.role !== "string") continue;
      const mparts = partsByMessage.get(m.id) ?? [];
      if (data.role === "user") {
        if (data.synthetic) continue;
        const texts = mparts.filter((p) => p?.type === "text").map((p) => p.text ?? "");
        const text = texts.join("\n").trim();
        if (text) out.push({ role: "user", text });
      } else if (data.role === "assistant") {
        const entry = { role: "assistant", texts: [], thoughts: [], tools: [] };
        for (const p of mparts) {
          if (p?.type === "text" && p.text) entry.texts.push(p.text);
          else if (p?.type === "reasoning" && p.text) entry.thoughts.push(p.text);
          else if (p?.type === "tool" && p.tool) {
            const state = p.state ?? {};
            entry.tools.push({
              callId: p.callID ?? p.callId,
              tool: p.tool,
              status: state.status ?? "completed",
              input: state.input,
              output: state.output ?? state.result,
            });
          }
        }
        if (entry.texts.length || entry.thoughts.length || entry.tools.length) out.push(entry);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
