#!/usr/bin/env bash
# zcode-acp 一键安装（WSL / Linux / macOS）：
#   1. 检查 Node.js >= 22
#   2. 从本仓库全局安装 zcode-acp
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

command -v npm >/dev/null 2>&1 || die "npm not found (should ship with Node.js)."

# ---------- 2. 全局安装 ----------
say "全局安装 zcode-acp（npm install -g）"
if npm install -g "$ROOT" >/dev/null; then
  ok "installed"
else
  # 无权限写全局目录（系统级 node 安装）时退回用户目录前缀
  warn "global install failed, retrying with user prefix (~/.npm-global)"
  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global"
  npm install -g "$ROOT" >/dev/null
  export PATH="$HOME/.npm-global/bin:$PATH"
  ok "installed to ~/.npm-global (ensure ~/.npm-global/bin is on PATH)"
fi

# ---------- 3. 自检 ----------
say "自检"
PKG_ROOT="$(npm root -g)/zcode-acp"
node "$PKG_ROOT/bin/zcode-acp.mjs" --self-check || die "self-check failed（按上方 PROBLEM 修复后重跑）"

# ---------- 4. Zed 配置片段 ----------
ENTRY="$PKG_ROOT/bin/zcode-acp.mjs"
say "安装完成。在 Zed 中启用（agents.json）"
ZED_CONFIG="$HOME/.config/zed/agents.json"
[ -n "${XDG_CONFIG_HOME:-}" ] && ZED_CONFIG="$XDG_CONFIG_HOME/zed/agents.json"
echo
echo "  $ZED_CONFIG"
echo
cat <<EOF
  [
    {
      "name": "ZCode",
      "command": { "path": "node", "args": ["$ENTRY"] }
    }
  ]
EOF
echo
printf "  ${GREEN}zcode-acp 命令:${OFF} %s\n" "$(dirname "$(command -v zcode-acp 2>/dev/null || echo "$HOME/.npm-global/bin/zcode-acp")")/zcode-acp"
printf "  ${GREEN}自检命令:${OFF}     node %s --self-check\n" "$ENTRY"
