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
| `src/logging.mjs` | 带轮转的追加写日志（默认 `~/.zcode/cli/log`，单文件超 5MB 轮转 `.old`） |
| `docs/` | zcode 协议快照与 ACP v2 参考文档 |

## 协议不变量（均有实证，改动前先读）

1. `session/cancel` 在 ACP 里是无 id 通知（Zed 中止按钮形态）；带 id 的请求形态并存。`_handleRequest` 与 `_handleNotification` 两个入口都必须分派，漏通知形态即中止失效。`$/cancel_request` 须对原请求回 `-32800` 并拒绝等待者。
2. app-server 对已随 `model.streaming`（kind=tool_call）流出的工具输入，会在 `tool.updated` 中剥离 `input`（`inputOmitted=true, inputRef=model_stream`）。适配器必须消费流式 `tool_call` 事件留档，并在 `tool.updated` 缺 input 时回填 `title`/`rawInput`，否则客户端只见工具名不见命令。
3. `session/resume` 响应与 `session/create` 同形：`slashCommands`、`settings.model.available`、`session.model/mode` 均在。新进程接管旧会话必须经 `_attach` 从中重建状态，否则丢命令表与模型目录。**注意 `session.mode` 换进程后恒为默认 build（resume 不回填持久化模式，实测）**：模式持久化在 sqlite `session_entry` 的 `runtime/execution_state`，`_attach` 须读取并以 `session/setMode` 恢复，否则重启 Zed 后 thread 丢失原模式。
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
14. 权限门控随会话模式（实测矩阵）：**build 门控 medium/high（Write、Bash rm 逐次询问，无会话级记忆），edit 门控 high；yolo 与 guarded 均不门控任何操作**（guarded 名实不符，实测连 Bash 删除都自动放行）。适配器默认跟随 zcode 会话默认 build——即开箱在 Zed 弹权限审批；不得回退强制 yolo（那会使弹窗永不出现）。
15. `interaction/requestPermission` 的 `options[].response` 是该选项的预制应答载荷：客户端选中后必须把对应 `response` 原样回传服务端（`allow_project` 携带 `permissionUpdates` 持久规则；kind `deny` 在 ACP 侧映射 `reject_once`）。服务端对未应答请求约 5s 超时后**以相同 requestId、逐字节相同的参数重发**——适配器按 `sessionId+requestId` 合并为一次客户端弹窗并广播应答；对已超时请求的迟到应答服务端忽略（实测无害）。v2 的 `session/request_permission` 主体字段名是 `subject.toolCall`（非 `toolCallUpdate`），Bash 类命令输入走 `type:"command"` 主体（command/cwd）。重发机制同样作用于 `interaction/requestUserInput`（提问）：适配器按 `sessionId+问题内容` 合并为一次 elicitation 弹窗并广播应答，否则无人值守时客户端反复弹窗（实测）。
16. `turn.failed` 的 `payload.error` 是结构化对象（实录 `{type, message, code, underlyingErrorMessage, attribution}`；模型请求失败时 `message:"Model request failed."`，根因在 `underlyingErrorMessage`），**不是字符串**——原样放进 ACP `state_update.error.message` 会在 v1 线上拼成 `[error] [object Object]`（实测 `/init` 时 provider 流断即此形态）。桥接层以 `failureText` 提取 `message+code+underlyingErrorMessage` 可读文本，v1 方言层对非字符串 message 再作 JSON 化兜底。
17. 凭据库 `~/.zcode/v2/credentials.json` 的值有两种加密格式（实测自 zcode 3.18.2 zcode.cjs）：`enc:v1:<iv>.<tag>.<data>`（key=sha256(env secret 或历史 fallback 推导)）与 **`enc:v2:<source>:<keyHint>:<iv>.<tag>.<data>`**（source∈`env`/`os`；key=sha256(secret)，keyHint=sha256(key).hex 前 24 位用于校验；env 的 secret 来源：`ZCODE_CREDENTIAL_SECRET` → `ZCODE_CREDENTIAL_SECRET_FILE` → credentials.json 同目录 `credential-secret` 文件（600 权限、32~4096 字节）；os 的 key 直接取自系统钥匙串，见本条末）。zcode 换格式不解密会让密文被当 api-key 注入，模型请求报「Client signing requires an API Key」——解密逻辑收敛在 `decryptCredential`（appserver-client.mjs）单点维护。os 来源的实现（逆向自 4.0.0 zcode.cjs，Windows 实测可解）：密钥在系统钥匙串，`@napi-rs/keyring` 的 AsyncEntry，service 为 `ZCode Credential Encryption`、user 为 credentials.json 绝对路径的 sha256 hex，条目值是 base64url(32 字节 key)。适配器以可选依赖 `@napi-rs/keyring` 读取（`osCredentialKey`，命中按文件缓存、未命中不缓存）：凭据库含 `enc:v2:os:` 值时才触碰钥匙串；`_codingPlanApiKeys` 是同步的，故 `AppServerClient` 在 `_start` 前经 `_loadOsKey` 读入，桥接侧 `_decryptCredential` 为异步。依赖缺失、无钥匙串服务（WSL 实测 254ms 内报 `org.freedesktop.secrets` 缺失）或条目不存在时解析为 null——仅套餐 key 不可解，不得影响其余功能。
18. zcode 以**延迟持久化**创建会话：未发过消息的空会话不在会话库中（`session` 表无行），换进程后 `session/resume` 应答 `-32603 project.session-lineage-invalid`（`data` 为序列化 Error `{name, stack}`；实测 Windows 与 Linux 4.0.0 一致）。Zed 在 `session/new` 应答后即保存线程，之后会经新连接对它 `session/load`（实测：新建后约 75 秒，期间未重启 Zed），面板显示 Failed to Launch。`session/create` 接受客户端指定的 `sessionId`（非空字符串即可），对已存在的 ID 应答 `-32602 sessionId already exists`——适配器据此对 `sess_*` 会话以同一 ID 重新 create 顶替（`_reviveVacantSession`）：会话 ID 不变、无历史可丢，真实会话（归属其他工作区、已删除）因唯一性校验不会被顶替而转为可读错误。不要改用 `persistence:"immediate"` 强制落盘（会让每个空线程入库）。
19. 编码套餐注入 provider 的模型清单 = 用户 `modelOrder` 在前 + 内置目录中该账号通道的 `builtinModelIds` 按目录顺序追加（`codingPlanModelIds`）。账号通道的 `modelOrder` 只是排序偏好而非白名单，当作白名单会使目录新增的模型（3.19.1 起的 GLM-5.4）永不出现。模型元数据由内置目录的 `modelRules` 按模型名匹配，与 provider 无关，个人 provider 下的同名模型得到相同的 contextWindow 与思考档位。过滤只有黑名单：账号通道被禁用的模型（`enabled:false`）从注入清单排除——内置目录 `modelConfigRules.builtinProviderModelRules` 给出缺省，用户的 `providerModelRules` 覆盖（`disabledModelIds`）。zcode 的注册表里成员 = `builtinModelIds` + 用户手工追加的 `personalModelIds`，`modelOrder` 只排序，内置模型不能删除只能停用；不要引入任何白名单（真实 app-server 三情形实测：用户禁用、内置缺省停用、用户重新启用）。

## 测试

- 每次改动必须全绿：`npm run test:unit`（即 `node test/unit-test.mjs && node test/v1-test.mjs && node test/appserver-unit-test.mjs`，不依赖网络与 zcode 进程）。
- `test/*-e2e-test.mjs` 驱动真实 zcode（需已登录，`npm run test:e2e`），重大链路改动再跑。
- 修复协议行为的改动必须带回归测试钉住线上形状（单测注入 FakeClient/PassThrough，不 mock 被测层）。
- 协议夹具必须固化自实录流量（`ZCODE_ACP_PROTOCOL_LOG` 或一次性探针驱动真实 zcode），不得凭想象构造：`tool.updated` 的结果字段曾因夹具写成想象中的 `output`（实测为 `result`，含 `content` 与 `display.structuredPatch`）而测试全绿、线上输出从未送达。新增协议消费字段前先以探针核对 `docs/zcode-protocol-snapshot.md`。

## 排障

- `ZCODE_ACP_PROTOCOL_LOG=<file>`：记录 app-server 原始出入站流量（截断逐行）。
- `ZCODE_ACP_LOG=<file>`：适配器运行日志。
- `ZCODE_BIN`：显式指定 zcode CLI（默认自动探测桌面版内置 CLI 或 PATH）。

## Zed 界面验收点（发版前逐项过）

前置：Zed `agent_servers` 中「ZCode」指向本适配器。安装副本是快照——改动仓库后必须重跑安装脚本（`./install.sh` / `install.cmd`）并让 Zed 重新加载 agent 才生效，Windows 与 WSL 各装各的；排障先确认 Zed 实际运行的副本是否含改动（看适配器进程命令行指向的 `pnpm/global/v11/<hash>/node_modules/zcode-acp`）。要 Zed 跟随仓库改动，把命令指向本仓库的 `bin/zcode-acp.mjs`。

1. 新建会话：`/` 菜单包含 goal、compact、init、skill 及技能命令（browser、documents、pdf 等）。
2. 恢复历史会话（Agent 面板历史列表打开旧会话）：`/` 菜单仍含 goal/init，不缺服务端命令；历史完整（超长会话取最近 2000 条尾部窗口，最近消息不丢失）。
3. 恢复历史会话：模式选择器显示该会话真实模式（重启 Zed/适配器后延续——模式取自会话存储的 execution_state，resume 响应不回填）；模型与思考强度选择器齐全且当前值正确。思考档位取自会话存储的 model_selection（resume 响应不带档位）；仅从未设置过档位的会话显示未选。
4. 生成进行中点中止：流式输出立即停止、turn 收束，无需重启会话即可继续对话。
5. 工具执行命令卡片：标题为裸命令原文（无「Bash:」前缀、无省略号截断）；右上角 copy 得到完整命令。
6. 权限弹窗（默认 build 模式即触发）：新建会话让模型执行写文件或运行命令，弹窗展示待执行命令；Allow 后执行、Deny 后跳过；弹窗停留 10 秒以上再批准不出现重复弹窗（重发已合并）；选「Always allow in this project」后同类操作不再询问；不想被打扰切 yolo 模式。
7. 切换模式/模型/思考档位：选择即时生效，下一轮按所选执行。
8. `@` 提及本地文件发送：模型能读到文件内容并围绕其作答；用户消息回显为 chip（不是 `[file: …]` 之类文本）。
9. 带图 prompt 发送：用户消息里图片只显示一份，不出现重复。
10. edit/write/read 类工具卡片：目标文件可点击打开（read 定位到对应行）；edit 卡片渲染红绿 diff，同文件多处编辑的标题含 old→new 摘要可区分；标题与输出仍正常展示。
11. 思考显示开关（Thinking Display）：默认精简——面板无思考流、回复照常；切「完整」后思考实时出线；恢复会话后开关回到默认精简（适配器本地状态，不持久化）。
12. 上下文容量指示（待 Zed 支持）：适配器每轮结束按规范发送 `usage_update`（used/size 成对，缺一不发）。**used 必须取主 turn 末次 `session.updated` 信封的 per-iteration `usage.inputTokens+outputTokens`（≈终态占用）**：`turn.completed.usage.totalTokens` 是全轮累计计费口径（Σ多次模型往返，带工具轮实测累计 67964 vs 占用 22841），直接采用会使用量破 100%；仅无信封且 `modelRequestCount=1` 时才可回退累计值。**size 必须取模型目录条目的 `contextWindow`（权威）**：`projection.contextWindow` 与 `runtime.contextUsage.size` 实测会回落为与当前模型不符的默认值（GLM 编码套餐 1M 模型换进程后两者均报 200000，曾使容量表显示 129% 而真实约 26%），仅目录缺失时才以下游来源兜底；信封的 `contextWindow`（实测恒 1000000，含 200K 的 deepseek）是工作区级数值、非模型窗口，不得用作 size。恢复/重挂的即时出线 used 以 `runtime.contextUsage.used` 为准（压缩会话跨进程 resume 的 `projection.contextUsed` 恒 0），两源皆 0 不发。历史回放 `readHistory` 取尾部窗口（默认最近 2000 条）——早前取头部 400 条，超限会话重启后丢失全部近期消息。当前已发布的 Zed 尚不渲染该通知；Zed 实现后验收：容量表随轮次增长、带工具轮不破 100%，`/compact` 后回落，恢复会话打开即有指示。
13. 上下文压缩（待 v2 客户端）：`/compact` 后适配器发出 `compaction_update`（in_progress → completed）；已发布 Zed 协商 v1（无此变体）不可见，属预期；v2 客户端应显示压缩标记。
14. 新建线程后不发消息，重启 Zed，从历史列表打开该空线程：正常打开、可直接对话，不出现 Failed to Launch（空会话顶替，适配器日志有 `recreated as an empty session`）。有消息的历史线程重启后仍带完整历史（验收点 2）。
15. 模型选择器含编码套餐目录的最新模型（对照 `~/.zcode/v2/runtime/provider/` 下最新 `zcode-builtin.json` 中 `account:*-coding-plan` 的 `builtinModelIds`），选中后可正常对话。凭据位于系统钥匙串的桌面环境（Windows）下同样出现；在桌面端停用某个套餐模型后，Zed 的选择器不再列出它。
