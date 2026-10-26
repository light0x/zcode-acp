# zcode-acp 一键安装（Windows）：
#   1. 检查 Node.js >= 22（zcode 桌面版内置 CLI 与本适配器都需要 Node 运行时）
#   2. 从本仓库全局安装 zcode-acp
#   3. 运行自检（解析 zcode、会话库）
#   4. 打印本机的 Zed agents.json 配置片段
# 用法：git clone 本仓库后，在仓库根目录执行
#   powershell -ExecutionPolicy Bypass -File install.ps1
# 或直接运行同目录的 install.cmd
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
function Say($m) { Write-Host "== $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  ok: $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "  error: $m" -ForegroundColor Red; exit 1 }

Say "zcode-acp 安装（Windows / $env:PROCESSOR_ARCHITECTURE）"

# ---------- 1. Node.js >= 22 ----------
Say "检查 Node.js"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host ""
  Write-Host "  未找到 node。请先安装 Node.js >= 22（内置 node:sqlite），再重跑本脚本："
  Write-Host "    官方安装器: https://nodejs.org/en/download"
  Write-Host "    winget install OpenJS.NodeJS"
  Write-Host "    scoop install nodejs"
  exit 1
}
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { Die "Node.js >= 22 required (built-in node:sqlite), found $(& node --version)." }
Ok "node $(& node --version)"

# ---------- 2. 全局安装 ----------
Say "全局安装 zcode-acp（npm install -g）"
Push-Location $Root
try {
  npm install -g . --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Die "npm install -g failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}
Ok "installed"

# ---------- 3. 自检 ----------
Say "自检"
$pkgRoot = (& npm root -g).Trim()
$entry = Join-Path $pkgRoot "zcode-acp\bin\zcode-acp.mjs"
if (-not (Test-Path $entry)) { Die "installed entry not found: $entry" }
& node $entry --self-check
if ($LASTEXITCODE -ne 0) { Die "self-check failed（按上方 PROBLEM 修复后重跑）" }

# ---------- 4. Zed 配置片段 ----------
Say "安装完成。在 Zed 中启用（agents.json）"
Write-Host ""
Write-Host "  %APPDATA%\Zed\agents.json   （Zed 内：agent panel settings -> open agents.json）"
Write-Host ""
$entryJson = $entry.Replace("\", "\\")
$cmdLine = '      "command": { "path": "node", "args": ["' + $entryJson + '"] }'
Write-Host "  ["
Write-Host "    {"
Write-Host '      "name": "ZCode",'
Write-Host $cmdLine
Write-Host "    }"
Write-Host "  ]"
Write-Host ""
$shim = Join-Path $env:APPDATA "npm\zcode-acp.cmd"
if (Test-Path $shim) {
  Write-Host "  zcode-acp 命令: $shim" -ForegroundColor Green
}
Write-Host "  自检命令:       node `"$entry`" --self-check" -ForegroundColor Green
