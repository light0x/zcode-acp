> ## ZCode Protocol 快照（逆向自 zcode 0.17.0，非官方文档）
> app-server 的 stdio 协议无公开文档；本文记录 zcode-acp 依赖的全部表面，
> 由 `test/appserver-unit-test.mjs`（假服务端）与 `test/appserver-e2e-test.mjs`（真实进程）钉住。
> zcode 升级后若字段漂移，以两套测试的失败点为线索对照本文更新。

# ZCode Protocol（app-server）快照

## 传输与封装

- 进程：`zcode app-server`（常驻；workspace 由每个 `session/create` 携带，不需要 `--cwd`）。
- 帧：单行 JSON。客户端请求 `{id, method, params}`；响应 `{id, result | error}`（JSON-RPC 2.0 错误码）。
- 服务端反向请求：id 形如 `server-N`，**必须应答**（`{id, result}`），否则服务端 15s 超时并使关联请求失败。
- 协议握手：无显式 initialize；连接后服务端即推送 `startup/*` 通知。会话响应自报
  `protocol: {name: "ZCode Protocol", version: 1}`。

## 客户端 → 服务端方法（zcode-acp 用到的子集）

| 方法 | 参数 | 结果 | 备注 |
| --- | --- | --- | --- |
| `session/create` | `{workspace: {workspacePath, workspaceKey}}` | `{session: {sessionId, mode, model: {providerId, modelId, options?}}, projection: {contextWindow, mode, status, …}, protocol}` | sessionKind/title 不是 create 参数 |
| `session/subscribe` | `{sessionId, deliveryKind: "desktop-continuous" \| "web-remote-replayable"}` | `{}` | 订阅后才开始收 `session/event` |
| `session/send` | `{sessionId, content: string}` | `{accepted: true, sessionId, stateRevision}` | 异步受理；turn 事件随后推送 |
| `session/stop` | `{sessionId}` | `{}` | 取消当前 turn |
| `session/setMode` | `{sessionId, mode: "build"\|"edit"\|"plan"\|"yolo"\|"guarded"}` | 投影 | yolo 下不再产生权限请求 |
| `session/setModel` | `{sessionId, model: {providerId, modelId, options?: {reasoningLevel}}}` | 投影 | 模型带 reasoning.levels 时该档位必填；不支持 `ref` 包装 |
| `session/setThoughtLevel` | `{sessionId, thoughtLevel}` | 投影 | 单独设思考档位 |
| `session/resume` | `{sessionId, workspace?}` | `{messages: [...]}` | 可跨进程重挂已持久化会话，响应自带历史 |
| `session/read` / `session/messages` | `{sessionId}` | `{messages: [...]}` | 历史读取 |
| `session/list` | `{}` | `{sessions: [{sessionId, mode, status, title, sessionKind, updatedAt, …}]}` | |
| `session/close` | `{sessionId}` | `{}` | |
| `session/compact` / `session/fork` / `session/goal` / `session/subagents` / `session/usage` / `session/debug` / `session/cancelBackgroundTask` | 未探明 | — | 方法注册表存在，zcode-acp 暂未使用 |

## 服务端 → 客户端反向请求

| 方法 | 参数 | 应答 |
| --- | --- | --- |
| `session/requestRuntimePreferences` | `{sessionId, scope: "runtime-materialization" \| "user-execution"}` | `{nativeSearchEnhancementsEnabled: boolean}`（建会话与每次 send 前各一次） |
| `interaction/requestPermission` | `{sessionId, requestId, toolCallId?, toolName, riskLevel, reason, input}` | `{decision: "allow" \| "deny" \| "escalate" \| "modify"}`；应答非法时服务端换 requestId 重问 |
| `interaction/requestOfficialMcpAuthHeaders` | `{mcpKey, pluginId, targetOrigin, workspace, …}` | 回 `{}` 可继续（正确形状待补） |

## 通知

- `startup/storageState | storagePath | storagePrepared`：启动阶段进度，可忽略。
- `state.updated`：`{patch, reason?, revision?, scope, sessionId?, workspace}`。
  - `patch.model.available[]`：模型目录，条目 `{ref: {providerId, modelId}, label, providerLabel, contextWindow, maxOutputTokens, reasoning: {levels: [{value, label}], defaultLevel}, properties: {inputFormat, outputFormat}}`；
  - `patch.model.current`：`{providerId, modelId, options: {reasoningLevel}}`；
  - `patch.mode.current`、`patch.status`（`running`/`idle`；turn 结束通常只有 `turn.completed`，`idle` 补丁仅作兜底信号）。
- `session/event`（须订阅）：信封 `{deliveryKind, eventId, seq, sessionId, timestamp, traceId?, turnId?, type, payload}`，
  **判别字段是 `type`**；`payload` 内含二级 `kind`（如 `model.streaming` 的 `text_delta`/`reasoning_delta`/`tool_input_*`）。

| type | payload 要点 | zcode-acp 映射 |
| --- | --- | --- |
| `turn.started` | input, messageId | → `state_update running` |
| `model.streaming` | `{assistantMessageId, delta, done, kind}`；kind 实测 `text_delta`/`reasoning_delta`/`tool_input_start`/`tool_input_delta`/`tool_call`（tool_call 携带完整 input） | `text_delta` → `agent_message_chunk`；`reasoning_delta` → `agent_thought_chunk`；`tool_call` → 输入留档供 `tool.updated` 剥离 input 时回填 |
| `tool.updated` | `kind` 实测 `scheduled`/`started`/`result`/`batch`；result 载荷 `{success, content, display: {kind: "file_diff", filePath, additions, deletions, structuredPatch: [{oldStart, oldLines, newStart, newLines, lines: [" "/"-"/"+" 前缀行"]}], truncated}, perf, truncated}`（**没有 `output` 字段**）；scheduled 常带 `inputOmitted: true, inputRef: "model_stream"` | → `tool_call_update`（pending/in_progress/completed；content 文本 → rawOutput，structuredPatch → diff 内容块） |
| `permission.requested` / `permission.resolved` | requestId, toolName, riskLevel, input | 与反向请求并存，zcode-acp 以反向请求为准 |
| `turn.completed` | response, tokenCount, usage{totalTokens, …}, toolCallCount | → `usage_update` + `state_update idle`（stopReason 按取消/状态映射） |
| `session.updated` / `session.titleUpdated` / `checkpoint.created` / `streamRecovery.updated` | 元数据 | 暂未消费 |

- `v4/telemetry/event`、`process/mcpTelemetry`、`process/resourceSample`、`computer-use/operation-event`：遥测/观测流，不出线到 ACP。

## 行为注记

- 插件 MCP（内置 documents/presentations/spreadsheets/pdf/node_repl、用户与插件级 MCP）由 app-server 按工作区自动装配，无需客户端干预。
- 会话持久化与桌面端共享同一 sqlite 存储：适配器 `session/list` 与历史回放继续走只读 sqlite
  （`~/.zcode/cli/db/db.sqlite`），`session/resume` 走协议重挂。
- 服务端请求 15s 超时（`Mnt=15e3`）；权限请求的观察窗口未测得超时，桌面端交互式等待可用。
