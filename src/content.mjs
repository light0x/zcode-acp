// ZCode part 模型与 ACP ContentBlock 之间的翻译。
// ZCode part: text | reasoning | file | tool | step-start | step-finish | snapshot |
//             patch | compaction | subagent | agent | retry
// ACP: text | image | audio | resource_link | resource

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

// ACP prompt blocks → { text, media }：文本类块拼接为文本，image/audio 块收集为
// { data(base64), mimeType } 列表（由后端分别经附件上传 / --attach 送达）。
export function splitPromptBlocks(blocks) {
  const parts = [];
  const media = [];
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
      case "resource_link":
        parts.push(`[file: ${block.uri ?? ""}${block.name ? ` (${block.name})` : ""}]`);
        break;
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
  return { text: parts.join("\n"), media };
}

// 纯文本场景的便捷包装（无媒体块时行为与旧版一致）
export function promptBlocksToText(blocks) {
  const { text, media } = splitPromptBlocks(blocks);
  if (media.length) {
    throw Object.assign(new Error("media blocks require an media-capable backend"), { code: -32602 });
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

// 工具 rawInput（ZCode input 对象）→ ACP tool_call_update 的 title 线索
export function deriveToolTitle(toolName, input) {
  const n = (toolName ?? "").toLowerCase();
  const i = input;
  if (typeof i === "object" && i !== null) {
    for (const key of ["command", "file_path", "path", "file", "url", "pattern", "query", "prompt", "description"]) {
      const v = i[key];
      if (typeof v === "string" && v.trim()) {
        const shown = v.length > 80 ? v.slice(0, 77) + "..." : v;
        return `${toolName ?? "tool"}: ${shown}`;
      }
    }
  }
  return toolName ?? "tool";
}
