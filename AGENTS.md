# AGENTS.md

面向在本仓库工作的编码代理与协作者：动代码前先读「协议不变量」；改动完成后按「测试」与「Zed 界面验收点」逐项确认。

## 项目概述

zcode-acp 把 zcode 接入 ACP（Agent Client Protocol）客户端：`initialize` 按对端协商 v1/v2 方言（已发布的 Zed 只说 v1），会话语义桥接到 zcode `app-server`（常驻协议进程，Zed 实际路径）或 `zcode -p`（无头逐 turn 进程）。运行时要求 Node >= 22（内置 node:sqlite）。

## 文档依据

1. Zcode官方文档：https://github.com/zai-org/ZCode/blob/main/docs/zcode-protocol.md
2. Zcode cli：https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/README.md

## 分层

| 文件 | 职责 |
| --- | --- |
| `bin/zcode-acp.mjs` | 入口：stdio 挂载 AcpAgent |
| `src/acp-server.mjs` | ACP 服务端：版本协商、入站请求与通知分发、权限与 elicitation 反向请求 |
| `src/acp-v1.mjs` | v1 方言（Zed）：方法面翻译、v2 更新拆分与改形 |
| `src/appserver-bridge.mjs` | app-server 后端桥接（会话状态、事件映射、附件上传） |
| `src/bridge.mjs` | 无头后端桥接（stream-json 逐 turn 进程） |
| `src/appserver-client.mjs` | app-server 进程监管、反向请求应答、provider 配置注入 |
| `src/zcode-headless.mjs` | 无头驱动、CLI 命令/技能清单查询、sqlite 只读访问 |
| `src/content.mjs` | part/content 翻译、命令表组装、工具标题、模式文案 |
| `src/rpc.mjs` | LineRpc：行 JSON 通道（ACP 侧带 jsonrpc 封装，zcode 侧不带） |
| `docs/` | zcode 协议快照与 ACP v2 参考文档 |

## 协议不变量（均有实证，改动前先读）

1. `session/cancel` 在 ACP 里是无 id 通知（Zed 中止按钮形态）；带 id 的请求形态并存。`_handleRequest` 与 `_handleNotification` 两个入口都必须分派，漏通知形态即中止失效。`$/cancel_request` 须对原请求回 `-32800` 并拒绝等待者。
2. app-server 对已随 `model.streaming`（kind=tool_call）流出的工具输入，会在 `tool.updated` 中剥离 `input`（`inputOmitted=true, inputRef=model_stream`）。适配器必须消费流式 `tool_call` 事件留档，并在 `tool.updated` 缺 input 时回填 `title`/`rawInput`，否则客户端只见工具名不见命令。
3. `session/resume` 响应与 `session/create` 同形：`slashCommands`、`settings.model.available`、`session.model/mode` 均在。新进程接管旧会话必须经 `_attach` 从中重建状态，否则丢命令表与模型目录。
4. v1 `LoadSessionResponse` 与 `NewSessionResponse` 同形（`modes` + `configOptions`）。恢复会话的应答必须携带，否则 Zed 不显示模型/思考强度选择。
5. v1 `session/new` 应答不能携带 `availableCommands`（客户端在注册会话前丢弃该通知）；命令表须在应答出线后异步 `_announceCommands` 发送。
6. 命令表合并顺序：服务端 `slashCommands`（权威，goal/compact/init）→ 桥接基线（compact/skill）→ `zcode commands list --json`（截前 100 条）→ `skills list --json`（`qualifiedName` 缺失时兜底 `name`），按 name 去重。
7. 工具 `title`：`command` 字段裸返回且不截断——Zed 的 copy 按 title 原样拷贝，前缀与省略号会混入命令；其余字段保留「工具名： 值」并限 80 字符。
8. Zed 的 `@` 文件提及在 `embeddedContext` 关闭时出线为 `resource_link` 块（`file:///` URI + name）。适配器把它解析为 zcode 原生 `file` kind 附件直挂 `localPath`（`sizeBytes` 必填）；目录、不存在或非 `file://` 的引用回落文本提示。用户消息回显分方言：v1 只发文本块（Zed 对已发送 prompt 做乐观渲染，重发图片/提及等非文本块会追加成重复 chip）；v2 按 spec 回显完整 content（按 messageId 对账，不重复）。
9. 端到端测试发 cancel 用的是带 id 请求，与 Zed 的通知形态不同；改取消链路必须补通知形态用例。
10. 工具调用的文件目标（`file_path`/`path`/`file` 输入）必须带 `locations`（可含 `line`），Zed 将其解析为可点击的文件位置；缺省时客户端无法打开目标文件。
11. 权限/提问挂起期间（v2）报 `state_update: requires_action`，应答后 turn 仍在进行才回 `running`（桥接 turn 状态守卫）；v1 方言对非 idle 态不出线，天然抑制。
12. 压缩生命周期来自 `session/event` 的 `session.updated` 信封（`operationId` 前缀 `cmp_*` + `status`），在 turn 守卫之前分派（自动压缩可能贴近 turn 边界）；摘要文本与 `summaryMessageId` 的字段对应未探明，摘要不出线——探明前不得凭想象补。
13. `session/list` 游标为不透明 base64url JSON `{offset}`，非法值回落第一页；无头桥接的本地 `acp_*` 会话仅在第一页合并。

## 测试

- 每次改动必须全绿：`node test/appserver-unit-test.mjs && node test/unit-test.mjs && node test/v1-test.mjs`（不依赖网络与 zcode 进程）。
- `test/*-e2e-test.mjs` 驱动真实 zcode（需已登录），重大链路改动再跑。
- 修复协议行为的改动必须带回归测试钉住线上形状（单测注入 FakeClient/PassThrough，不 mock 被测层）。
- 协议夹具必须固化自实录流量（`ZCODE_ACP_PROTOCOL_LOG` 或一次性探针驱动真实 zcode），不得凭想象构造：`tool.updated` 的结果字段曾因夹具写成想象中的 `output`（实测为 `result`，含 `content` 与 `display.structuredPatch`）而测试全绿、线上输出从未送达。新增协议消费字段前先以探针核对 `docs/zcode-protocol-snapshot.md`。

## 排障

- `ZCODE_ACP_PROTOCOL_LOG=<file>`：记录 app-server 原始出入站流量（截断逐行）。
- `ZCODE_ACP_LOG=<file>`：适配器运行日志。
- `ZCODE_BIN`：显式指定 zcode CLI（默认自动探测桌面版内置 CLI 或 PATH）。

## Zed 界面验收点（发版前逐项过）

前置：Zed `agent_servers` 中「ZCode Windows」指向本适配器（全局 `zcode-acp` 链接本仓库时，改动即时生效）。

1. 新建会话：`/` 菜单包含 goal、compact、init、skill 及技能命令（browser、documents、pdf 等）。
2. 恢复历史会话（Agent 面板历史列表打开旧会话）：`/` 菜单仍含 goal/init，不缺服务端命令。
3. 恢复历史会话：模式选择器显示该会话真实模式；模型与思考强度选择器齐全且当前值正确。思考档位取自会话存储的 model_selection（resume 响应不带档位）；仅从未设置过档位的会话显示未选。
4. 生成进行中点中止：流式输出立即停止、turn 收束，无需重启会话即可继续对话。
5. 工具执行命令卡片：标题为裸命令原文（无「Bash:」前缀、无省略号截断）；右上角 copy 得到完整命令。
6. guarded 模式触发写操作：权限弹窗展示待执行命令；allow 后执行、deny 后跳过。
7. 切换模式/模型/思考档位：选择即时生效，下一轮按所选执行。
8. `@` 提及本地文件发送：模型能读到文件内容并围绕其作答；用户消息回显为 chip（不是 `[file: …]` 之类文本）。
9. 带图 prompt 发送：用户消息里图片只显示一份，不出现重复。
10. edit/write/read 类工具卡片：目标文件可点击打开（read 定位到对应行）；edit 卡片渲染红绿 diff，同文件多处编辑的标题含 old→new 摘要可区分；标题与输出仍正常展示。
11. 思考显示开关（Thinking Display）：默认精简——面板无思考流、回复照常；切「完整」后思考实时出线；恢复会话后开关回到默认精简（适配器本地状态，不持久化）。
12. 上下文容量指示（待 Zed 支持）：适配器每轮结束已按规范发送 `usage_update`（used/size 成对），但当前已发布的 Zed 尚不渲染该通知——输入区无容量表不是适配器缺陷；Zed 实现后验收：容量表随轮次增长，`/compact` 后回落；恢复会话后首轮完成前无指示（turn.completed 才有占用数据）。
13. 上下文压缩（待 v2 客户端）：`/compact` 后适配器发出 `compaction_update`（in_progress → completed）；已发布 Zed 协商 v1（无此变体）不可见，属预期；v2 客户端应显示压缩标记。
