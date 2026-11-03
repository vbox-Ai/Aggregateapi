#!/bin/bash
# ── Agent2API · iOS 守护进程安装脚本（在越狱机本地或经 SSH 跑）──────────
# 把 Android 模块的 service.sh / supervisor.sh / control.sh 那套，
# 换成 launchd 的等价物。
#
# 用法（在电脑上，面向手机）：
#   DEV=root@192.168.1.23 ./scripts/install-daemon.sh
# 用法（在手机 NewTerm 里，本机）：
#   DEV= ./scripts/install-daemon.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="${DEV:-}"
BIN="${BIN:-$ROOT/../Agent2API/desktop-tauri/src-tauri/target/aarch64-apple-ios/release/agent2api-server}"
UI_SRC="${UI_SRC:-$ROOT/../_a2a/ui}"
SETUP="${SETUP:-/var/jb}"
LABEL="com.chiyu.agent2api"
DATA="/var/mobile/Library/agent2api"
PREFIX_DEST="$SETUP/usr/local"

[ -f "$BIN" ] || { echo "找不到 Mach-O 二进制：$BIN"; echo "先编：cargo build -p agent2api-server --release --target aarch64-apple-ios"; exit 1; }
[ -d "$UI_SRC" ] || { echo "找不到面板资源：$UI_SRC"; exit 1; }
file "$BIN" | grep -q "Mach-O" || { echo "不是 Mach-O，别把 Android 的 ELF 传上去"; exit 1; }

rsh() { if [ -n "$DEV" ]; then ssh "$DEV" "$@"; else "$@"; fi; }
rcp() { if [ -n "$DEV" ]; then scp -q "$1" "$DEV:$2"; else cp "$1" "$2"; fi; }

echo "==> [1/6] 建目录"
rsh "mkdir -p '$DATA' '$PREFIX_DEST/bin' '$PREFIX_DEST/share/agent2api' '$SETUP/Library/LaunchDaemons'" 2>/dev/null || true
rsh "chown -R mobile:mobile '$DATA'" 2>/dev/null || true

echo "==> [2/6] 传二进制与面板"
rcp "$BIN" "$PREFIX_DEST/bin/agent2api-server"
rsh "rm -rf '$PREFIX_DEST/share/agent2api/ui'"
if [ -n "$DEV" ]; then
  tar -C "$UI_SRC" -czf - . | ssh "$DEV" "mkdir -p '$PREFIX_DEST/share/agent2api/ui' && tar -C '$PREFIX_DEST/share/agent2api/ui' -xzf -"
else
  mkdir -p "$PREFIX_DEST/share/agent2api/ui"
  cp -R "$UI_SRC/." "$PREFIX_DEST/share/agent2api/ui/"
fi

echo "==> [3/6] 传 LaunchDaemon"
rcp "$ROOT/daemon/$LABEL.plist" "$SETUP/Library/LaunchDaemons/$LABEL.plist"

echo "==> [4/6] 权限与签名"
rsh "chmod 755 '$PREFIX_DEST/bin/agent2api-server'
     chown -R mobile:mobile '$PREFIX_DEST/share/agent2api' 2>/dev/null || true
     chown root:wheel '$SETUP/Library/LaunchDaemons/$LABEL.plist'
     chmod 644 '$SETUP/Library/LaunchDaemons/$LABEL.plist'
     command -v ldid >/dev/null && ldid -S '$PREFIX_DEST/bin/agent2api-server' || echo '  (无 ldid，跳过签名)'"

echo "==> [5/6] 加载守护进程"
rsh "launchctl bootout system/$LABEL 2>/dev/null || true
     launchctl bootstrap system '$SETUP/Library/LaunchDaemons/$LABEL.plist' 2>/dev/null \
       || launchctl load -w '$SETUP/Library/LaunchDaemons/$LABEL.plist'"

echo "==> [6/6] 健康检查（最多等 20s）"
for i in $(seq 1 20); do
  sleep 1
  OUT="$(rsh "curl -s --max-time 2 http://127.0.0.1:3065/health" 2>/dev/null || true)"
  if echo "$OUT" | grep -q '"ok"'; then
    echo "    ✅ $OUT"
    echo
    echo "面板：http://127.0.0.1:3065/   （手机本体浏览器 / 装好的 App）"
    echo "日志：$DATA/server.log"
    echo "重启：launchctl kickstart -k system/$LABEL"
    echo "停止：launchctl bootout   system/$LABEL"
    exit 0
  fi
  printf '.'
done
echo
echo "❌ /health 无响应。排查顺序："
echo "  1) launchctl print system/$LABEL | head -40      # 看 last exit reason"
echo "  2) tail -50 $DATA/server.log"
echo "  3) 手工前台跑：AGENT2API_PROXY_HOME=$DATA AGENT2API_UI_DIR=$PREFIX_DEST/share/agent2api/ui $PREFIX_DEST/bin/agent2api-server"
echo "  4) 若是 codesigning 被杀：ldid -S $PREFIX_DEST/bin/agent2api-server 后重试"
exit 1
