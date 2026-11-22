# zcode-acp 一键安装（Windows）：
#   1. 检查 Node.js >= 22（zcode 桌面版内置 CLI 与本适配器都需要 Node 运行时）
#   2. 打包 tarball，pnpm 优先全局安装（快照副本，非仓库软链——包管理器对本地目录安装会创建 link，tarball 安装则是快照）
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
# 原生命令的单行 stdout（去空白）。无输出/失败时返回 ""——PS 的空管道经 [string] 强转仍是 null，
# 直接 .Trim() 会抛 "null-valued expression"（pnpm root -g 失败等场景实测），故统一走此助手。
function NativeLine([scriptblock]$s) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { return "$(& $s 2>$null)".Trim() } finally { $ErrorActionPreference = $eap }
}
# 来源提交：打印 HEAD 供核对是否最新；pack 按 bin/src 白名单打包，脏区检查只看会随包安装的路径。
# 先把控制台输出编码切到 UTF-8，否则中文 commit subject 会按系统 ANSI 代码页解码成乱码。
function Show-SourceCommit {
  $savedEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Warn "未找到 git，无法显示提交信息"; return }
    $commit = & git -C $Root log -1 --format='%h %s (%cd)' --date=iso 2>$null
    if (-not $commit) { Warn "非 git 仓库检出，无法显示提交信息"; return }
    Write-Host ("  来源提交: " + ($commit -join " ")) -ForegroundColor Green
    if (& git -C $Root status --porcelain -- bin src README.md package.json 2>$null) {
      Warn "bin/src/package.json 存在未提交改动，安装内容可能超出该提交"
    }
  } finally {
    $ErrorActionPreference = $savedEap
  }
}

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

# ---------- 2. 打包并全局安装 ----------
# 包管理器：pnpm 优先（用户全局工具链），回落 npm；两者皆无才失败。
# 原生命令的 2>$null 重定向需在 EAP=Continue 下进行（PS 5.1 会把 stderr 行变成 NativeCommandError），同 Show-SourceCommit。
Say "选择包管理器"
$pm = $null
$savedEap = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $pv = NativeLine { pnpm --version }
    if ($LASTEXITCODE -eq 0 -and $pv) { $pm = "pnpm"; Ok "pnpm $pv（优先）" }
  }
  if (-not $pm -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    $pm = "npm"; Ok "npm $(NativeLine { npm --version })"
  }
} finally { $ErrorActionPreference = $savedEap }
if (-not $pm) { Die "neither pnpm nor npm found (pnpm preferred; npm ships with Node.js)." }

Show-SourceCommit

# 打包到临时目录（仓库根不落产物）；pnpm pack 失败时回落 npm pack
Say "打包 zcode-acp（pack → tarball）"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("zcode-acp-pack-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
$packedWith = $null
$tarball = $null
$savedEap = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  Push-Location $Root
  try {
    if ($pm -eq "pnpm") {
      & pnpm pack --pack-destination $tmp 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $packedWith = "pnpm" }
    }
    if (-not $packedWith -and (Get-Command npm -ErrorAction SilentlyContinue)) {
      & npm pack --pack-destination $tmp 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $packedWith = "npm" }
    }
  } finally { Pop-Location }
  if (-not $packedWith) { Die "pack failed（pnpm/npm pack 均未成功）" }
  $tarball = Get-ChildItem $tmp -Filter "zcode-acp-*.tgz" | Select-Object -First 1
  if (-not $tarball) { Die "tarball not found after pack" }
  Ok ("packed " + $tarball.Name + "（$packedWith pack）")

  # 安装 tarball：快照副本而非仓库链接（pnpm/npm add 本地目录会创建 link: 依赖）
  Say "全局安装 zcode-acp（$pm add -g，tarball 快照副本）"
  $installed = $false
  if ($pm -eq "pnpm") {
    & pnpm add -g $tarball.FullName 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $installed = $true
      Ok "installed（pnpm 标准布局，快照不随仓库变动；升级重跑 install.ps1）"
    } else {
      Warn "pnpm install failed, retrying with npm"
      $pm = "npm"
    }
  }
  if (-not $installed) {
    & npm install -g $tarball.FullName 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "npm install -g failed (exit $LASTEXITCODE)" }
    Ok "installed（快照不随仓库变动；升级重跑 install.ps1）"
  }

  # 残留双装检查：另一包管理器全局还留有旧副本时，PATH 上 shim 会互相遮蔽
  if ($pm -ne "npm" -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    $npmRoot = NativeLine { npm root -g }
    if ($npmRoot -and (Test-Path (Join-Path $npmRoot "zcode-acp"))) {
      Warn "npm 全局仍装有 zcode-acp（旧副本），建议 npm uninstall -g zcode-acp 后重跑，避免 PATH shim 冲突"
    }
  }
  if ($pm -ne "pnpm" -and (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $pnpmRoot = NativeLine { pnpm root -g }
    if ($pnpmRoot -and (Test-Path (Join-Path $pnpmRoot "zcode-acp"))) {
      Warn "pnpm 全局仍装有 zcode-acp（旧副本），建议 pnpm rm -g zcode-acp 后重跑，避免 PATH shim 冲突"
    }
  }
} finally {
  $ErrorActionPreference = $savedEap
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ---------- 3. 自检 ----------
# 入口解析：pnpm shim 优先——pnpm ≥12 全局目录按次安装哈希编址（<root>/<hash>/node_modules/zcode-acp），
# .mjs 入口路径随重装变化，而 shim（pnpm bin -g）路径稳定，自检与 Zed 配置都走它；
# shim 不可用时按布局发现 .mjs（经典 <root>\zcode-acp 或哈希目录），npm 则用稳定的 npm root -g 布局。
Say "自检"
$entry = $null
$pnpmBin = $null
$savedEap = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  if ($pm -eq "pnpm") {
  $pnpmBin = NativeLine { pnpm bin -g }
  if ($pnpmBin -and (Test-Path (Join-Path $pnpmBin "zcode-acp.cmd"))) {
    $entry = Join-Path $pnpmBin "zcode-acp.cmd"
  } else {
    $pnpmRoot = NativeLine { pnpm root -g }
      if ($pnpmRoot) {
        $classic = Join-Path $pnpmRoot "zcode-acp\bin\zcode-acp.mjs"
        if (Test-Path $classic) {
          $entry = $classic
        } else {
          $found = Get-ChildItem $pnpmRoot -Recurse -Filter "zcode-acp.mjs" -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -like "*node_modules\zcode-acp\bin\zcode-acp.mjs" } |
            Select-Object -First 1
          if ($found) { $entry = $found.FullName }
        }
      }
    }
  }
  if (-not $entry -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    $npmRoot = NativeLine { npm root -g }
    if ($npmRoot) { $entry = Join-Path $npmRoot "zcode-acp\bin\zcode-acp.mjs" }
  }
} finally { $ErrorActionPreference = $savedEap }
if (-not $entry) { Die "installed entry not found（未能解析安装副本入口）" }
if (-not (Test-Path $entry)) { Die "installed entry not found: $entry" }
if ($entry -like "*.mjs") {
  & node $entry --self-check
} else {
  & $entry --self-check
}
if ($LASTEXITCODE -ne 0) { Die "self-check failed（按上方 PROBLEM 修复后重跑）" }

# ---------- 4. Zed 配置片段 ----------
Say "安装完成。在 Zed 中启用（agents.json）"
Write-Host ""
Write-Host "  %APPDATA%\Zed\agents.json   （Zed 内：agent panel settings -> open agents.json）"
Write-Host ""
$entryJson = $entry.Replace("\", "\\")
if ($entry -like "*.mjs") {
  # npm 布局：入口路径稳定，node + .mjs 直指安装副本
  $cmdLine = '      "command": { "path": "node", "args": ["' + $entryJson + '"] }'
} else {
  # pnpm shim：路径稳定，升级重装后 Zed 配置无需改动（shim 内部跟随新哈希目录）
  $cmdLine = '      "command": { "path": "' + $entryJson + '", "args": [] }'
}
Write-Host "  ["
Write-Host "    {"
Write-Host '      "name": "ZCode",'
Write-Host $cmdLine
Write-Host "    }"
Write-Host "  ]"
Write-Host ""
if ($pm -eq "pnpm" -and $pnpmBin) {
  Write-Host "  zcode-acp 命令: $(Join-Path $pnpmBin 'zcode-acp.cmd')" -ForegroundColor Green
} else {
  $shim = Join-Path $env:APPDATA "npm\zcode-acp.cmd"
  if (Test-Path $shim) {
    Write-Host "  zcode-acp 命令: $shim" -ForegroundColor Green
  }
}
Write-Host "  自检命令:       zcode-acp --self-check" -ForegroundColor Green
Write-Host "  开发提示:       让 Zed 跟随仓库改动调试时，把 agents.json 的 args 指向本仓库 bin\zcode-acp.mjs（安装副本是快照，需重跑 install.ps1 更新）" -ForegroundColor Yellow
