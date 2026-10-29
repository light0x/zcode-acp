# zcode-acp

[zcode CLI](https://z.ai) 的 [ACP（Agent Client Protocol）](https://agentclientprotocol.com/)适配器。
作为 ACP Agent 运行，把 Zed 等编辑器的 ACP 请求翻译为 zcode app-server 调用：
**持有一个常驻 app-server 子进程**，流式输出、模型与思考强度选择、权限交互、插件 MCP 全量可用。

```
Zed / ACP 客户端 ──ACP v1/v2 (stdio JSON-RPC 2.0)──> zcode-acp ──ZCode Protocol (stdio)──> zcode app-server
                                                      │
                                                      └──只读──> ~/.zcode/cli/db/db.sqlite（会话列表与历史回放）
```

零 npm 依赖，仅需 Node.js ≥ 22（内置 `node:sqlite`）与已登录的 zcode（`zcode login`）。
同一套代码跨平台：Linux / macOS / WSL 自动探测 `~/.zcode/server/bin/zcode`；
Windows 自动探测桌面版内置 CLI（`%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`，用同一 Node 运行时执行）。

## 部署

### 一键安装（git clone 后）

前置：本机已装 [Node.js ≥ 22](https://nodejs.org)（内置 `node:sqlite`）并完成 `zcode login`。

```bash
# WSL / Linux / macOS：仓库根目录
./install.sh
```

```powershell
# Windows PowerShell：仓库根目录
powershell -ExecutionPolicy Bypass -File install.ps1
# 或直接双击 / 命令行运行 install.cmd
```

脚本执行四步：检查 Node ≥ 22 → `npm install -g` 本仓库 → 运行 `--self-check`
自检（解析 zcode 可执行文件与版本、会话库可读性）→ 打印本机的 Zed `agents.json`
配置片段（绝对路径，与安装位置一致，直接复制即可）。

`--self-check` 也可随时单独运行排障：

```bash
node "$(npm root -g)/zcode-acp/bin/zcode-acp.mjs" --self-check   # Unix
node "%APPDATA%\npm\node_modules\zcode-acp\bin\zcode-acp.mjs" --self-check   # Windows
```

### 手动安装（备用）

<details>
<summary>不用脚本时按下面步骤操作</summary>

```bash
# WSL / Linux / macOS
npm pack                 # 生成 zcode-acp-<version>.tgz
npm i -g ./zcode-acp-<version>.tgz
```

```powershell
# Windows
npm i -g C:\path\to\zcode-acp-<version>.tgz
```

</details>

### Zed 配置

前置：本机已完成安装（上文）与 `zcode login`。一键脚本最后会打印与本机安装位置一致的配置片段，直接复制即可；手动配置如下。

**当前版 Zed**——写 `settings.json` 的 `agent_servers` 键（命令面板执行 `zed: open settings` 打开）：

```jsonc
{
  "agent_servers": {
    "ZCode": {
      "type": "custom",
      "command": "zcode-acp",   // Windows 下解析不到裸名时改为 "zcode-acp.cmd"
      "args": [],
      "env": {}
    }
  }
}
```

**旧版 Zed**（设置里没有 `agent_servers` 键时）——用 `agents.json`：

```jsonc
// WSL / Linux / macOS：~/.config/zed/agents.json；Windows：%APPDATA%\Zed\agents.json
[
  {
    "name": "ZCode",
    "command": { "path": "zcode-acp", "args": [] }   // Windows 改 "zcode-acp.cmd"
  }
]
```

zcode 装在自定义位置时经 `env` 传入。自动探测顺序：`ZCODE_BIN` 环境变量
→ `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
→ `C:\Program Files\ZCode\resources\glm\zcode.cjs` → PATH 上的 `zcode.exe`：

```jsonc
"command": {
  "path": "zcode-acp.cmd",
  "args": [],
  "env": { "ZCODE_BIN": "D:\\Tools\\zcode\\zcode.exe" }
}
```

`env` 里也可设适配器行为开关，例如思考流默认完整显示（缺省精简）：

```jsonc
"env": { "ZCODE_ACP_THINKING_DISPLAY": "full" }
```

配置保存后，Agent 面板的新建会话菜单出现 ZCode，选中即开始对话。SSH remote / WSL 跨端部署见下两节；
`ZCODE_*` 环境变量一览见「快速开始」。自检失败时按 `PROBLEM` 行修复（缺 Node、zcode 未登录等），再重跑安装脚本即可。

### 一套配置跨 Windows 与 SSH Linux/WSL

Zed 在**项目所在主机**上拉起 external agent（SSH remote 项目 → agent 在远端跑；
Windows 本地项目 → agent 在 Windows 跑）。因此"一份配置两端通用"的正确做法是：
两台主机各跑一次安装脚本，配置里只写命令名，不写平台相关路径：

```jsonc
// 新版 Zed：settings.json 的 agent_servers（两端内容完全相同）
{
  "agent_servers": {
    "ZCode": {
      "type": "custom",
      "command": "zcode-acp",
      "args": [],
      "env": {}
    }
  }
}
```

要点：

- Windows 端探测桌面版内置 CLI、Linux 端探测 `~/.zcode/server/bin/zcode`，
  差异全部由适配器吸收，配置无需体现。
- SSH 打开 Linux 项目时 agent 在远端执行——远端必须先跑一遍 Linux 侧安装与 `zcode login`。
- Windows 上 npm shim 是 `zcode-acp.cmd`，Zed 按 PATH+PATHEXT 解析裸名即可命中；
  若个别 Zed 版本解析不到，把 `command` 改成 `"zcode-acp.cmd"`（唯一需要分叉的地方）。
- Linux 端注意 nvm 的 PATH 陷阱：Zed remote server 由 sshd 拉起，非登录 shell 可能
  不含 `~/.nvm` 路径。建议系统级 Node 安装，或补一个链接：
  `sudo ln -s "$(which zcode-acp)" /usr/local/bin/`。

### Windows 的 Zed 连 WSL 内的 agent（可选）

把 agent 留在 WSL（复用 WSL 侧登录态与会话库），Zed 用 `wsl.exe` 拉起：

```jsonc
[
  {
    "name": "ZCode (WSL)",
    "command": {
      "path": "wsl.exe",
      "args": ["-e", "/home/<user>/.nvm/versions/node/<v>/bin/zcode-acp"]
    }
  }
]
```

注意：此形态下 agent 进程与 zcode、会话库都在 WSL 侧，`session/new` 的 `cwd` 应为 WSL 路径（如 `/home/<user>/project`）。

### 双端独立说明

Windows 与 WSL 各有一套 zcode 安装（各自 `~/.zcode` 的登录态、配置、插件与会话库），
分别部署的 zcode-acp 互不可见对方会话——`session/list`/`resume` 只显示本侧历史。这是预期行为。

## 快速开始（直接运行，不装包）

```jsonc
// Zed（~/.config/zed/agents.json）
[
  {
    "name": "ZCode",
    "command": {
      "path": "node",
      "args": ["/absolute/path/to/zcode-acp/bin/zcode-acp.mjs"]
    }
  }
]
```

环境变量：

| 变量 | 说明 |
| --- | --- |
| `ZCODE_BIN` | zcode 可执行文件或 CLI 入口（支持二进制与 `.cjs` 脚本）；缺省按平台自动探测 |
| `ZCODE_DB_PATH` | zcode 会话库路径；缺省 `~/.zcode/cli/db/db.sqlite`（只读访问） |
| `ZCODE_ACP_LOG` | 调试日志路径；缺省 `~/.zcode/cli/log/zcode-acp-adapter.log`（5MB 轮转） |
| `ZCODE_ACP_PROTOCOL_LOG` | app-server 原始出入站流量；缺省 `~/.zcode/cli/log/zcode-acp-protocol.log`（5MB 轮转） |
| `ZCODE_ACP_BACKEND` | `appserver`（默认）或 `headless`；headless 回退为每 turn 一个 `zcode -p --output-format stream-json` 进程（无模型选择/权限交互；流式经官方 stream-json 事件支持） |
| `ZCODE_ACP_THINKING_DISPLAY` | 思考流显示的会话默认值：`full` 时默认显示思考流；缺省 `concise`（精简，不显示）。面板开关可按会话覆盖此默认 |

## 会话内配置选项

在 Zed 中的操作位置：接入后（见「Zed 配置」）在 Agent 面板新建会话并选择 ZCode；
消息输入框上方的会话配置区就是下列选项的选择器（模式 / 模型 / 思考强度 / 思考显示），
点开选择即时生效。排查选项是否送达可用命令面板 `dev: open acp logs` 查看 ACP 流量。

| 选项 | 取值 | 默认 | 说明 |

| 选项 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| Permission Mode（`zcode.mode`） | plan / build / edit / yolo / guarded | yolo | 权限模式，语义与 `zcode --mode` 一致；非 yolo 模式写操作弹权限确认 |
| Model（`zcode.model`） | 模型目录全量 | 会话当前值 | 切换模型（映射 `session/setModel`） |
| Thinking（`zcode.reasoning`） | 当前模型的思考档位 | 模型默认档位 | 模型**实际**思考强度；越强思考越久、输出越长 |
| Thinking Display（`zcode.thinking_display`） | 精简 (Concise) / 完整 (Full) | **精简**（可经 `ZCODE_ACP_THINKING_DISPLAY` 改默认） | 思考流**是否显示**：精简隐藏思考只看回复与工具卡片；完整实时显示思考过程 |

Thinking Display 使用要点：

- 默认精简：觉得思考输出太多无需任何操作；想看推理过程时切到「完整」，下一批思考增量即出线。
- 想让「完整」成为所有会话的默认：在 Zed 的 `agent_servers.ZCode.env` 里设 `"ZCODE_ACP_THINKING_DISPLAY": "full"`（见「Zed 配置」），面板开关仍可按会话覆盖。
- 仅是显示开关，不改变模型实际思考强度与计费（那是 Thinking 选项）；两档下回复内容一致。
- 历史回放（恢复会话）同样遵守开关：精简时回放不含思考块。
- 适配器本地状态、不持久化：恢复会话后回到默认值（精简或 env 设定的默认），需要时再切一次。
- 编程切换：v1/v2 均可 `session/set_config_option`（`configId: "zcode.thinking_display"`，值 `concise`/`full`）；非法值返回 `-32602`。

## 协议版本

`initialize` 按客户端请求的 `protocolVersion` 协商，一个连接只说一个版本：请求 ≥2 服务 ACP v2，
请求 1 服务 v1（当前已发布的 Zed 发送 1；v2 为官方草案）。

| 能力 | v1 | v2 |
| --- | --- | --- |
| initialize 结果 | `agentCapabilities` + `agentInfo`（声明 `loadSession`） | `capabilities`（基线 `session: {}`）+ `info` |
| turn 生命周期 | `session/prompt` 挂起至 turn 结束，以 `{stopReason}` 应答 | 插入即应答 `{messageId}`，`state_update idle` 收束 |
| 消息更新 | `*_chunk` 分块（content 单块） | `user_message` / `agent_message` / `agent_thought` 整消息 |
| 工具调用 | `tool_call` 先建再 `tool_call_update` | 首个 `tool_call_update` 即建 |
| 停止原因 | 5 种（无 `error`） | 含 `error` |
| 模式切换 | `modes` 随 `session/new` 返回 + `session/set_mode` | `session/set_config_option`（`configOptions`） |
| 恢复会话 | `session/load`（回放完历史再应答 `{}`） | `session/resume`（可带 `replayFrom`） |
| 斜杠命令 | `available_commands_update` 通知（input 无标签） | 随 `session/new` 返回（input 带 `type`） |

v1 差异的吸收方式：turn 出错时错误文本以消息分块送达、`stopReason` 回落 `end_turn`；
工具 `cancelled` 状态映射为 `failed`；`state_update` 不出线，仅作内部收束信号。

## 架构与功能映射（ACP ↔ zcode app-server）

| ACP 方法 | 实现 |
| --- | --- |
| `initialize` | 按请求的 `protocolVersion` 协商方言，交换能力（差异见「协议版本」） |
| `session/new` | `session/create`（workspace 取 cwd），返回斜杠命令表与 config options；v1 另以 `modes` 呈现权限模式 |
| `session/prompt` | `session/send` 异步受理；`model.streaming` 事件逐字翻译为分块（文本/思考），`turn.completed` 携带 usage 并收束 turn |
| `session/cancel` | `session/stop`，turn 结束后以 cancelled 收束 |
| `session/resume`（v1 为 `session/load`） | 协议 `session/resume` 重挂（跨适配器重启亦可）；从头回放经 sqlite 历史翻译为更新流 |
| `session/list` | 只读查询 sqlite `session` 表（按 cwd 过滤，含标题与更新时间） |
| `session/close` | `session/close` 并释放本地状态 |
| `session/set_config_option`（v1 为 `session/set_mode`） | `zcode.mode` → `session/setMode`；`zcode.model` / `zcode.reasoning` → `session/setModel`；`zcode.thinking_display` → 适配器本地思考流显示开关；结果回传更新后的配置 |
| 非法值（`-32602`） | 未知 configId、越界的 model/reasoning 取值 |
| 斜杠命令（`/compact`、`/skill`、插件命令） | prompt 文本以 `/` 开头时原样透传，由 zcode 服务端处理 |
| 权限请求（`build`/`edit`/`guarded` 模式） | 服务端反向请求 `interaction/requestPermission` → ACP `session/request_permission`（Zed 权限弹窗）→ `{decision}` 回传；无应答按 deny 收敛 |

历史回放：`replayFrom: {type:"start"}`（v1 `session/load` 固定从头回放）时从 sqlite `message`/`part` 表
读出会话历史，翻译为 `user_message`（过滤 synthetic 注入）、`agent_thought`、`tool_call_update`（含 input/output）、
`agent_message`，再发当前 idle 状态。不支持的自定义 cursor 类型返回 `-32602`。

会话 ID：`session/create` 直接返回 zcode 原生 `sess_*` ID，即 ACP sessionId；
`session/list` 返回同一命名空间，均可用于 `session/resume`。

进程模型：适配器持有一个常驻 app-server 子进程，崩溃后自动重启并以 `session/resume` 重挂活跃会话
（连接代数守卫，避免重复重挂）。app-server 启动硬性要求成对的内置/个人 provider 配置路径——
桌面 ZCode 通过环境变量传入，独立环境（如 Zed）由适配器自动探测注入：优先 `~/.zcode/v2/runtime/provider/`
下最新的运行期物化副本，回退安装包内静态副本（`resources/config/provider/zcode-builtin.json`），
个人配置缺省 `~/.zcode/v2/provider_config.json`。协议细节见
[docs/zcode-protocol-snapshot.md](docs/zcode-protocol-snapshot.md)，由假服务端单元测试与真实进程端到端测试双向钉住。

## 功能完备性

| 能力 | 状态 | 实现方式 |
| --- | --- | --- |
| session（new/prompt/cancel/resume/list/close/set_config_option） | ✅ | ACP 七个基线方法全实现；会话与历史读写 app-server 协议 + sqlite 会话存储 |
| 模型 / 思考强度 | ✅ | 全量目录来自 `session/create` 的 `settings.model.available` 快照，`state.updated` 补丁按 model 合并更新当前 provider 的可用集；`zcode.model` / `zcode.reasoning` 两个 config option 映射 `session/setModel`，v1 客户端经 `session/set_config_option` 同样可用。编码套餐账号通道（`account:*-coding-plan`）仅桌面上下文物化——适配器按官方「启动器从受控凭据来源写入临时配置」模式（usage/03-config.md），将凭据库解密的套餐 key 以 `personalModelIds` 形态注入临时个人配置副本（`~/.zcode/cli/zcode-acp-provider-config.json`），使套餐 GLM 模型在独立会话可选 |
| 流式输出 | ✅ | app-server：`model.streaming` 的 `text_delta` / `reasoning_delta` 逐字翻译为 `agent_message_chunk` / `agent_thought_chunk`（思考流出线受 `zcode.thinking_display` 控制，默认精简）；无头回退后端经官方 `--output-format stream-json` 事件同样逐字流式 |
| 权限交互 | ✅ | 非 yolo 模式下 `interaction/requestPermission` → ACP `session/request_permission`（Zed 弹窗）→ `{decision}`；默认 `yolo` 自动放行，可用 config option 切换 |
| command（斜杠命令） | ✅ | `session/new`/`resume` 返回 `availableCommands`：内置命令（`/compact`、`/skill`）+ `commands list` 的自定义/插件命令（含参数 hint）；用户输入的 `"/name args"` 原样透传（`/compact`、`/skill`、插件命令均已验证生效） |
| skill（技能） | ✅ | `/skill <name> <task>` 调用；技能清单（`skills list`）拼入 `/skill` 命令描述供挑选；工作区与用户级技能自动生效 |
| plugin / MCP 服务器 | ✅ | app-server 按工作区自动装配 zcode 已启用插件的全部能力（命令、技能、MCP 服务器、hooks）；ACP `session/new` 的 `mcpServers` 透传不适用（未声明该能力） |
| memory（记忆） | ✅（随 zcode 配置） | zcode 自身读取 `~/.zcode` 记忆库；ACP 协议无 memory 方法，适配器不做干预 |
| 工具调用展示 | ✅ | 实时状态迁移（pending → in_progress → completed/failed）；标题带语义（命令原文 / 文件路径 + old→new 摘要）；文件目标带 locations 可点击打开；输出文本随完成事件回传；edit/write 的 `structuredPatch` 转 diff 内容块——Zed 渲染红绿 diff，v1 由 git_patch 文本还原 oldText/newText |
| 图片/音频输入（prompt image/audio 块） | ✅ | 同一通路：app-server 走官方分块上传协议（v4/attachment/begin→chunk→commit）随 session/send 附件发送；无头后端落临时文件经官方 --attach。模型是否按视觉/听觉处理取决于 zcode 侧对该模型+媒体类型的呈现（实测各模型不一，纯色小图可能诱发逐字节解码） |
| 任务清单（todo） | ✅ | zcode todos → ACP plan 更新（v1 plan／v2 plan_update），create 快照 + turn 后 diff 同步 |
| 提问（AskUserQuestion） | ✅ | app-server interaction/requestUserInput → ACP elicitation/create（form 单选），应答按 question 键回传 answers |
| 会话历史（v1） | ✅ | v1 session/list＋session/close 路由并声明 sessionCapabilities；Zed 历史浏览器可用 |

## 测试

```bash
node test/unit-test.mjs           # 无头桥接单元测试（注入替身，无网络）
node test/v1-test.mjs             # v1 方言协议测试（内存流驱动，无网络）
node test/appserver-unit-test.mjs # app-server 桥接协议映射测试（假服务端，无网络）
node test/e2e-test.mjs            # 模拟 ACP v2 客户端全流程（需 zcode 已登录）
node test/e2e-test.mjs --quick    # 只跑核心对话链路
node test/v1-e2e-test.mjs         # 以 v1 客户端驱动真实 zcode
node test/appserver-e2e-test.mjs  # app-server 后端全链路（配置切换/流式/取消）
```

## 代码结构

```
bin/zcode-acp.mjs           入口：装配 bridge 与 ACP 服务端并挂到 stdio（ZCODE_ACP_BACKEND 可选后端）
src/rpc.mjs                 逐行 JSON 消息通道（ACP 侧带 JSON-RPC 封装；app-server 侧裸 {id,method,params}）
src/acp-server.mjs          ACP Agent：版本协商、session/* 方法分派、权限请求双向代理
src/acp-v1.mjs              ACP v1 方言：方法面映射与更新翻译（分块、tool_call 先建后更、state_update 抑制）
src/appserver-client.mjs    app-server 协议客户端：进程监管、反向请求应答、原始流量日志（ZCODE_ACP_PROTOCOL_LOG）
src/appserver-bridge.mjs    app-server 桥接：事件流 → ACP 更新、模型/思考强度 config options、权限决策
src/bridge.mjs              无头桥接（回退后端）：每 turn 一个 zcode -p 进程
src/zcode-headless.mjs      zcode 可执行探测 + sqlite 只读访问 + 命令/技能清单
src/content.mjs             内容块与工具元数据翻译
test/unit-test.mjs          无头桥接单元测试
test/v1-test.mjs            v1 方言协议测试
test/appserver-unit-test.mjs app-server 桥接协议映射测试（假服务端）
test/e2e-test.mjs           端到端测试（v2 全流程）
test/v1-e2e-test.mjs        端到端测试（v1）
test/appserver-e2e-test.mjs 端到端测试（app-server 配置/流式/取消）
docs/v2-*.md                ACP v2 规范快照（参考）
docs/zcode-protocol-snapshot.md  ZCode Protocol 逆向快照（由测试钉住）
```

## 已知限制

- 无头回退后端的限制：无模型选择/权限交互（编码套餐 GLM 等账号通道模型不可用）；工具调用的输入/输出内容暂不回传（仅状态迁移与标题）。
- `session/delete` 未实现且不计划实现：app-server 未提供删除方法，官方文档明确禁止直接改 sqlite 会话库，故能力保持未声明（合规）。
- 同一会话的 turn 串行排队执行；不同会话并行。
- TUI 专属斜杠命令（`/new` `/mode` `/model` `/fork` `/rewind` 等）不适用；对应能力由 ACP 方法（config option、resume）与 `interaction/requestOfficialMcpAuthHeaders` 之外的反向请求覆盖。
- `interaction/requestOfficialMcpAuthHeaders` 反向请求暂以空对象应答（官方 MCP 鉴权头待补）。
