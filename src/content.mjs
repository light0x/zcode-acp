// ZCode part 模型与 ACP ContentBlock 之间的翻译。
// ZCode part: text | reasoning | file | tool | step-start | step-finish | snapshot |
//             patch | compaction | subagent | agent | retry
// ACP: text | image | audio | resource_link | resource
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 组装 ACP 斜杠命令表：内置命令（/compact、/skill）+ 自定义/插件命令（含参数 hint）。
// /skill 描述拼入技能清单供挑选，但只展示前几名并硬限总长（避免长列表撑爆弹窗）。
export async function buildAvailableCommands(listCliCommands, listCliSkills) {
  const commands = [
    {
      name: "compact",
      description: "Compact the zcode session context",
      input: { type: "text", hint: "optional compaction instructions" },
    },
    {
      name: "skill",
      description: "Load a zcode skill for this turn: /skill <name> <task>",
      input: { type: "text", hint: "skill name followed by the task" },
    },
  ];
  try {
    const listed = await listCliCommands();
    for (const c of (listed?.commands ?? []).slice(0, 100)) {
      if (!c?.name || commands.some((x) => x.name === c.name)) continue;
      commands.push({
        name: c.name,
        description: c.description ?? `zcode command ${c.name}`,
        ...(c.argumentHint ? { input: { type: "text", hint: c.argumentHint } } : {}),
      });
    }
  } catch {}
  try {
    const skills = await listCliSkills();
    // 每个已加载技能一条独立命令（与桌面一致）；描述取首句并限长
    for (const s of (skills?.skills ?? [])) {
      const name = s.qualifiedName ?? s.name;
      if (!name || commands.some((x) => x.name === name)) continue;
      const firstSentence = (s.description ?? "").split(/(?<=[.。!？?])\s/)[0] || `Invoke the ${name} skill`;
      commands.push({
        name,
        description: firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}…` : firstSentence,
        input: { type: "text", hint: `task for the ${name} skill` },
      });
    }
  } catch {}
  return commands;
}

// 权限模式的展示文案（与桌面 ZCode zh-CN 资源一致，id 后缀保证与 CLI --mode 值可对上）；
// description 会随 v1 modes / v2 configOptions 送达，Zed 在模式选择器悬停时展示。
export const MODE_PRESENTATION = {
  plan: {
    name: "计划模式 (Plan)",
    description: "编辑前先出计划；限制写入与命令执行（非系统级沙箱）",
  },
  build: {
    name: "变更前确认 (Build)",
    description: "改文件前先问我；有副作用的工具需要审批",
  },
  edit: {
    name: "自动编辑 (Edit)",
    description: "自动编辑工作区文件；其余权限判定同 Build",
  },
  yolo: {
    name: "完全访问 (Yolo)",
    description: "跳过权限提示自动执行；Hook 与工具级限制仍生效",
  },
  guarded: {
    name: "自主模式 (Guarded)",
    description: "宽松执行，危险命令仍逐次批准",
  },
};

// 媒体 mime → 文件扩展名（附件上传/临时 --attach 文件名用）
const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
};

export function extForMime(mimeType) {
  const lower = (mimeType ?? "").toLowerCase();
  if (MIME_EXT[lower]) return MIME_EXT[lower];
  const sub = lower.split("/")[1]?.replace(/[^a-z0-9]/gi, "");
  return sub || "bin";
}

// ACP prompt blocks → { text, media, files, links }：文本类块拼接为文本，image/audio 块收集为
// { data(base64), mimeType } 列表；resource_link（Zed @ 提及的出线形态）解析为本地文件条目
// （由后端以 localPath 附件送达，与桌面 @ 提及同语义），目录/不存在/非 file:// 的引用回落文本提示。
// links 原样带回供回显（客户端按 chip 渲染）。
const TEXT_EXTS = new Set([
  "md", "markdown", "txt", "json", "jsonc", "yaml", "yml", "toml", "xml", "csv", "log", "ini", "cfg", "conf", "env",
  "js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx", "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "ps1", "psm1", "bat", "cmd", "sql",
  "html", "htm", "css", "scss", "vue", "svelte", "gitignore", "dockerfile",
]);

function guessMime(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  if (TEXT_EXTS.has(ext)) return "text/plain";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function resolveResourceLink(block) {
  const uri = block.uri ?? "";
  const name = block.name ?? "";
  let p = null;
  if (uri.startsWith("file://")) {
    try {
      p = fileURLToPath(uri);
    } catch {
      p = null;
    }
  }
  if (p) {
    try {
      const s = fs.statSync(p);
      if (s.isFile()) {
        return {
          file: { path: p, name: name || path.basename(p), mimeType: block.mimeType ?? guessMime(p), size: s.size },
        };
      }
    } catch {}
  }
  return { cue: `[file: ${uri}${name ? ` (${name})` : ""}]` };
}

export function splitPromptBlocks(blocks) {
  const parts = [];
  const media = [];
  const files = [];
  const links = [];
  for (const block of blocks) {
    switch (block?.type) {
      case "text":
        parts.push(block.text ?? "");
        break;
      case "image":
      case "audio":
        if (typeof block.data !== "string" || !block.data) {
          throw Object.assign(new Error(`${block.type} block requires base64 data`), { code: -32602 });
        }
        media.push({ data: block.data, mimeType: block.mimeType ?? (block.type === "audio" ? "audio/mpeg" : "image/png") });
        break;
      case "resource_link": {
        const r = resolveResourceLink(block);
        links.push(block);
        if (r.cue) parts.push(r.cue);
        else files.push(r.file);
        break;
      }
      case "resource": {
        const r = block.resource ?? {};
        const text = typeof r.text === "string" ? r.text : "";
        parts.push(text ? `[file: ${r.uri ?? ""}]\n${text}` : `[file: ${r.uri ?? ""}]`);
        break;
      }
      default:
        throw Object.assign(new Error(`unsupported prompt content block type: ${block?.type}`), {
          code: -32602,
        });
    }
  }
  return { text: parts.join("\n"), media, files, links };
}

// 纯文本场景的便捷包装（无媒体/文件/链接块时行为与旧版一致）
export function promptBlocksToText(blocks) {
  const { text, media, files, links } = splitPromptBlocks(blocks);
  if (media.length || files.length || links.length) {
    throw Object.assign(new Error("non-text prompt blocks require a media-capable backend"), { code: -32602 });
  }
  return text;
}

// ZCode tool part 的 state → ACP ToolCallStatus
export function toolStateToStatus(state) {
  // ZCode tool state: pending|running|completed|errored|stopped 等字符串
  switch (state) {
    case "pending":
      return "pending";
    case "running":
      return "in_progress";
    case "completed":
      return "completed";
    case "errored":
    case "failed":
      return "failed";
    case "stopped":
    case "cancelled":
      return "cancelled";
    default:
      return state ? state : "pending";
  }
}

// ZCode 工具名 → ACP ToolKind
export function toolNameToKind(name) {
  const n = (name ?? "").toLowerCase();
  if (n === "think" || n === "todowrite" || n === "todoread" || n === "plan") return "think";
  if (n.includes("read")) return "read";
  if (n.includes("edit") || n.includes("write")) return "edit";
  if (n.includes("delete") || n.includes("remove") || n === "rm") return "delete";
  if (n.includes("move") || n.includes("rename")) return "move";
  if (n.includes("grep") || n.includes("glob") || n.includes("search") || n.includes("find")) return "search";
  if (n.includes("bash") || n.includes("exec") || n.includes("run") || n === "task") return "execute";
  if (n.includes("fetch") || n.includes("web")) return "fetch";
  return "other";
}

// 工具 rawInput（ZCode input 对象）→ ACP tool_call_update 的 title 线索。
// command 不加前缀不截断：Zed 的 copy 按 title 原样拷贝，前缀/省略号会混进命令。
// 同文件多处编辑的卡片以 old→new 摘要区分，避免一排同路径卡片无法辨认。
export function deriveToolTitle(toolName, input) {
  const i = input;
  if (typeof i === "object" && i !== null) {
    for (const key of ["command", "file_path", "path", "file", "url", "pattern", "query", "prompt", "description"]) {
      const v = i[key];
      if (typeof v === "string" && v.trim()) {
        if (key === "command") return v;
        const shown = v.length > 80 ? v.slice(0, 77) + "..." : v;
        const hint = editChangeHint(i);
        return `${toolName ?? "tool"}: ${shown}${hint ? ` · ${hint}` : ""}`;
      }
    }
  }
  return toolName ?? "tool";
}

// old_string/new_string 摘要（换行折叠，双侧各限 24 字符）
function editChangeHint(i) {
  const oldS = typeof i.old_string === "string" ? i.old_string : "";
  const newS = typeof i.new_string === "string" ? i.new_string : "";
  if (!oldS && !newS) return "";
  const one = (s) => s.replace(/\s+/g, " ").trim().slice(0, 24);
  return `${one(oldS)} → ${one(newS)}`;
}

// 工具结果 → 展示文本。app-server 的真实字段是 result（content 字符串 + display 补丁），
// 无头存储/旧流量为 output；content 字符串优先，其余对象回退 JSON，避免整包 perf 噪声出线。
export function toolResultText(result) {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result;
  if (typeof result.content === "string") return result.content;
  return JSON.stringify(result) ?? String(result);
}

// result.display.structuredPatch（实测 zcode file_diff）→ v2 diff 内容块，每个 hunk 一块。
// patch 文本为自生成 git_patch，v1 方言由它还原 oldText/newText 供 Zed 渲染红绿 diff。
export function toolResultDiffBlocks(result) {
  const display = result?.display;
  const hunks = display?.structuredPatch;
  const filePath = display?.filePath;
  if (!Array.isArray(hunks) || !hunks.length || typeof filePath !== "string" || !filePath) return [];
  const blocks = [];
  for (const h of hunks) {
    const lines = Array.isArray(h?.lines) ? h.lines : [];
    if (!lines.length) continue;
    blocks.push({
      type: "diff",
      changes: [{ operation: "modify", path: filePath, fileType: "text" }],
      patch: {
        format: "git_patch",
        text:
          `diff --git ${filePath} ${filePath}\n--- ${filePath}\n+++ ${filePath}\n` +
          `@@ -${h.oldStart ?? 0},${h.oldLines ?? 0} +${h.newStart ?? 0},${h.newLines ?? 0} @@\n` +
          `${lines.join("\n")}\n`,
      },
    });
  }
  return blocks;
}

// 工具 rawInput → ACP locations（文件目标），客户端据此渲染可点击的文件位置。
export function deriveToolLocations(input) {
  if (typeof input !== "object" || input === null) return [];
  const out = [];
  for (const key of ["file_path", "path", "file"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) {
      out.push(typeof input.line === "number" ? { path: v, line: input.line } : { path: v });
      break;
    }
  }
  return out;
}
