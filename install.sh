#!/usr/bin/env bash
# zcode-acp 一键安装（WSL / Linux / macOS）：
#   1. 检查 Node.js >= 22
#   2. 打包 tarball，pnpm 优先全局安装（快照副本，非仓库软链——包管理器对本地目录安装会创建 link，tarball 安装则是快照），
#      并移除另一包管理器全局的旧副本——只保留一种安装
#   3. 运行自检（解析 zcode、会话库）
#   4. 打印本机的 Zed agents.json 配置片段
# 用法：git clone 本仓库后，在仓库根目录执行 ./install.sh
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CYAN='\033[1;36m'; GREEN='\033[1;32m'; YELLOW='\033[1;33m'; RED='\033[1;31m'; OFF='\033[0m'
say() { printf "${CYAN}==${OFF} %s\n" "$*"; }
ok() { printf "${GREEN}  ok:${OFF} %s\n" "$*"; }
warn() { printf "${YELLOW}  !${OFF} %s\n" "$*"; }
die() { printf "${RED}  error:${OFF} %s\n" "$*" >&2; exit 1; }

# 单一安装收敛：移除另一包管理器全局的 zcode-acp 旧副本，PATH 上只保留本次安装的 shim。
# 包目录已删而 shim 残留（孤儿）时卸载命令是空操作，故卸载后再按文件名清扫。
remove_stale_copy() {
  local other="$1" root bindir present="" has_shim="" name
  local -a cmd
  local shim_names="zcode-acp zcode-acp.cmd zcode-acp.ps1"
  if [ "$other" = npm ]; then
    root="$(npm root -g 2>/dev/null || true)"
    bindir="$(npm prefix -g 2>/dev/null || true)"
    cmd=(npm uninstall -g zcode-acp)
    # npm 的 shim 在 Unix 位于 <prefix>/bin，在 Git Bash（Windows npm）下位于 prefix 本身
    case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ;; *) [ -n "$bindir" ] && bindir="$bindir/bin" ;; esac
    if [ -n "$root" ] && [ -d "$root/zcode-acp" ]; then present=1; fi
  else
    root="$(pnpm root -g 2>/dev/null || true)"
    bindir="$(pnpm bin -g 2>/dev/null || true)"
    cmd=(pnpm remove -g zcode-acp)
    # pnpm ≥12 的包在哈希子目录 <root>/<hash>/node_modules 下
    if [ -n "$root" ] && { [ -d "$root/zcode-acp" ] || compgen -G "$root/*/node_modules/zcode-acp" >/dev/null; }; then present=1; fi
  fi
  for name in $shim_names; do
    if [ -n "$bindir" ] && [ -f "$bindir/$name" ]; then has_shim=1; fi
  done
  if [ -z "$present" ] && [ -z "$has_shim" ]; then return 0; fi
  if [ -n "$present" ] && ! "${cmd[@]}" >/dev/null 2>&1; then
    warn "无法移除 $other 全局的 zcode-acp 旧副本，请手动执行：${cmd[*]}（避免 PATH 上 shim 互相遮蔽）"
    return 0
  fi
  for name in $shim_names; do
    [ -n "$bindir" ] && [ -f "$bindir/$name" ] && rm -f "$bindir/$name"
  done
  ok "removed $other 全局的 zcode-acp 旧副本（只保留 $PM 这一种安装）"
}

say "zcode-acp 安装（$(uname -s) / $(uname -m)）"

# ---------- 1. Node.js >= 22 ----------
say "检查 Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  未找到 node。请先安装 Node.js >= 22（内置 node:sqlite），再重跑本脚本："
  echo "    官方安装器: https://nodejs.org/en/download（含 Linux 二进制包说明）"
  echo "    WSL/Debian/Ubuntu: sudo apt install nodejs npm（需 >= 22，过旧时用 NodeSource 源）"
  echo "    macOS: brew install node@22 && brew link --overwrite node@22"
  echo "    Fedora/RHEL: sudo dnf module install nodejs:22"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js >= 22 required (built-in node:sqlite), found $(node --version). Install Node 22+ then re-run."
ok "node $(node --version)"

# ---------- 2. 打包并全局安装 ----------
# 包管理器：pnpm 优先（用户全局工具链），回落 npm；两者皆无才失败
say "选择包管理器"
PM=""
if command -v pnpm >/dev/null 2>&1 && pnpm --version >/dev/null 2>&1; then
  PM=pnpm
  ok "pnpm $(pnpm --version)（优先）"
elif command -v npm >/dev/null 2>&1; then
  PM=npm
  ok "npm $(npm --version)"
else
  die "neither pnpm nor npm found (pnpm preferred; npm ships with Node.js)."
fi

# 来源提交：打印 HEAD 供核对是否最新；pack 按 bin/src 白名单打包，脏区检查只看会随包安装的路径
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  COMMIT="$(git -C "$ROOT" log -1 --format='%h %s (%cd)' --date=iso 2>/dev/null || true)"
  if [ -n "$COMMIT" ]; then
    printf "  ${GREEN}来源提交:${OFF} %s\n" "$COMMIT"
    [ -n "$(git -C "$ROOT" status --porcelain -- bin src README.md package.json 2>/dev/null)" ] \
      && warn "bin/src/package.json 存在未提交改动，安装内容可能超出该提交"
  fi
else
  warn "非 git 仓库检出，无法显示提交信息"
fi

# 打包到临时目录（仓库根不落产物）；pnpm pack 失败时回落 npm pack
say "打包 zcode-acp（pack → tarball）"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PACKED_WITH=""
if [ "$PM" = pnpm ] && (cd "$ROOT" && pnpm pack --pack-destination "$TMP" >/dev/null 2>&1); then
  PACKED_WITH=pnpm
elif command -v npm >/dev/null 2>&1 && (cd "$ROOT" && npm pack --pack-destination "$TMP" >/dev/null 2>&1); then
  PACKED_WITH=npm
else
  die "pack failed（pnpm/npm pack 均未成功）"
fi
TARBALL="$(find "$TMP" -maxdepth 1 -name 'zcode-acp-*.tgz' | head -n 1 || true)"
[ -n "$TARBALL" ] || die "tarball not found after pack"
ok "packed $(basename "$TARBALL")（$PACKED_WITH pack）"

# 安装 tarball：快照副本而非仓库链接（pnpm/npm add 本地目录会创建 link: 依赖）
say "全局安装 zcode-acp（$PM add -g，tarball 快照副本）"
INSTALL_OK=0
if [ "$PM" = pnpm ]; then
  if POUT="$(pnpm add -g "$TARBALL" 2>&1)"; then
    INSTALL_OK=1
    ok "installed（pnpm 标准布局，快照不随仓库变动；升级重跑 ./install.sh）"
  else
    if [ -n "$POUT" ]; then printf '%s\n' "$POUT" | tail -n 3 >&2; fi
    warn "pnpm install failed, retrying with npm"
    PM=npm
  fi
fi
if [ "$INSTALL_OK" -eq 0 ]; then
  command -v npm >/dev/null 2>&1 || die "npm not found (should ship with Node.js), cannot retry install."
  if npm install -g "$TARBALL" >/dev/null 2>&1; then
    INSTALL_OK=1
    ok "installed（快照不随仓库变动；升级重跑 ./install.sh）"
  else
    # 无权限写全局目录（系统级 node 安装）时退回用户目录前缀
    warn "global install failed, retrying with user prefix (~/.npm-global)"
    mkdir -p "$HOME/.npm-global"
    npm config set prefix "$HOME/.npm-global"
    npm install -g "$TARBALL" >/dev/null
    export PATH="$HOME/.npm-global/bin:$PATH"
    ok "installed to ~/.npm-global (ensure ~/.npm-global/bin is on PATH)"
  fi
fi

# 单一安装：另一包管理器全局的旧副本直接移除，PATH 上只保留本次安装的 shim
if [ "$PM" != npm ] && command -v npm >/dev/null 2>&1; then remove_stale_copy npm; fi
if [ "$PM" != pnpm ] && command -v pnpm >/dev/null 2>&1; then remove_stale_copy pnpm; fi

# ---------- 3. 自检 ----------
# 入口解析：pnpm shim 优先——pnpm ≥12 全局目录按次安装哈希编址（<root>/<hash>/node_modules/zcode-acp），
# .mjs 入口路径随重装变化，而 shim（pnpm bin -g）路径稳定，自检与 Zed 配置都走它；
# shim 不可用时按布局发现 .mjs（经典 <root>/zcode-acp 或哈希目录），npm 则用稳定的 npm root -g 布局。
say "自检"
ENTRY=""
PMBIN=""
if [ "$PM" = pnpm ]; then
  PMBIN="$(pnpm bin -g 2>/dev/null || true)"
  if [ -n "$PMBIN" ] && [ -x "$PMBIN/zcode-acp" ]; then
    ENTRY="$PMBIN/zcode-acp"
  else
    PG="$(pnpm root -g 2>/dev/null || true)"
    if [ -n "$PG" ] && [ -d "$PG/zcode-acp" ]; then
      ENTRY="$PG/zcode-acp/bin/zcode-acp.mjs"
    elif [ -n "$PG" ]; then
      FOUND="$(find "$PG" -maxdepth 5 -path '*/node_modules/zcode-acp/bin/zcode-acp.mjs' 2>/dev/null | head -n 1 || true)"
      [ -n "$FOUND" ] && ENTRY="$(dirname "$(dirname "$FOUND")")"
    fi
  fi
fi
if [ -z "$ENTRY" ]; then
  ENTRY="$(npm root -g 2>/dev/null || true)/zcode-acp/bin/zcode-acp.mjs"
fi
if [ "${ENTRY##*.}" = "mjs" ]; then
  [ -f "$ENTRY" ] || die "installed entry not found: ${ENTRY}"
  node "$ENTRY" --self-check || die "self-check failed（按上方 PROBLEM 修复后重跑）"
else
  [ -x "$ENTRY" ] || die "installed entry not found: ${ENTRY}"
  "$ENTRY" --self-check || die "self-check failed（按上方 PROBLEM 修复后重跑）"
fi

# ---------- 4. Zed 配置片段 ----------
say "安装完成。在 Zed 中启用（agents.json）"
ZED_CONFIG="$HOME/.config/zed/agents.json"
[ -n "${XDG_CONFIG_HOME:-}" ] && ZED_CONFIG="$XDG_CONFIG_HOME/zed/agents.json"
echo
echo "  $ZED_CONFIG"
echo
if [ "${ENTRY##*.}" = "mjs" ]; then
  # npm 布局：入口路径稳定，node + .mjs 直指安装副本
  cat <<EOF
  [
    {
      "name": "ZCode",
      "command": { "path": "node", "args": ["$ENTRY"] }
    }
  ]
EOF
else
  # pnpm shim：路径稳定，升级重装后 Zed 配置无需改动（shim 内部跟随新哈希目录）
  cat <<EOF
  [
    {
      "name": "ZCode",
      "command": { "path": "$ENTRY", "args": [] }
    }
  ]
EOF
fi
echo
if [ "$PM" = pnpm ] && [ -n "$PMBIN" ]; then
  printf "  ${GREEN}zcode-acp 命令:${OFF} %s\n" "$PMBIN/zcode-acp"
else
  printf "  ${GREEN}zcode-acp 命令:${OFF} %s\n" "$(dirname "$(command -v zcode-acp 2>/dev/null || echo "$HOME/.npm-global/bin/zcode-acp")")/zcode-acp"
fi
printf "  ${GREEN}自检命令:${OFF}     zcode-acp --self-check\n"
printf "  ${YELLOW}开发提示:${OFF} 让 Zed 跟随仓库改动调试时，把 agents.json 的 args 指向本仓库 bin/zcode-acp.mjs（安装副本是快照，需重跑 ./install.sh 更新）\n"
