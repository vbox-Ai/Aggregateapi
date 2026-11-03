#!/usr/bin/env bash
# ── Agent2API · iOS 守护进程一键安装（Release 的 ios-daemon-kit.zip 专用）──────
#
# 用法（在手机上用 NewTerm / SSH，root）：
#   1) 把 ios-daemon-kit.zip 解压到任意目录（Filza 也行）
#   2) cd 到该目录，执行：  bash install-daemon-kit.sh
#
# 它会做四件事：
#   · agent2api-server → /var/jb/usr/local/bin/（rootless 前缀，非 rootless 自动退 /usr/local/bin）
#   · com.chiyu.agent2api.plist → <prefix>/Library/LaunchDaemons/
#   · 数据目录 /var/mobile/Library/agent2api 建好并 chown mobile（App 与 daemon 同 uid 才能共享 SQLite）
#   · ldid 签名 → launchctl bootstrap → /health 自检
#
# 不做任何"回滚"：失败就把原因打出来（与你要求一致）。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_SRC="$HERE/agent2api-server"
PLIST_SRC="$HERE/com.chiyu.agent2api.plist"
LABEL="com.chiyu.agent2api"
DATA="/var/mobile/Library/agent2api"

say() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "需要 root：请用 ssh root@ 或 NewTerm 里的 su"
[ -f "$BIN_SRC" ] || die "缺少 agent2api-server（请确认在 kit 解压目录里执行）"
[ -f "$PLIST_SRC" ] || die "缺少 com.chiyu.agent2api.plist"

# rootless 越狱（palera1n 等）用 /var/jb 前缀；否则老式根目录布局
if [ -d /var/jb ]; then PREFIX=/var/jb; else PREFIX=""; fi
BIN_DIR="$PREFIX/usr/local/bin"
PLIST_DIR="$PREFIX/Library/LaunchDaemons"
say "安装前缀：${PREFIX:-/（老式布局）}"

mkdir -p "$BIN_DIR" "$PLIST_DIR" "$DATA"
chown mobile:mobile "$DATA" 2>/dev/null || true
chmod 700 "$DATA" 2>/dev/null || true

say "拷贝并签名守护进程"
cp -f "$BIN_SRC" "$BIN_DIR/agent2api-server"
chmod 755 "$BIN_DIR/agent2api-server"
if command -v ldid >/dev/null 2>&1; then
  ldid -S "$BIN_DIR/agent2api-server" && echo "    ldid 签名完成"
else
  echo "    ⚠ 没装 ldid（apt install ldid），AMFI 可能拒绝执行"
fi
file "$BIN_DIR/agent2api-server" | head -1

say "安装 LaunchDaemon"
cp -f "$PLIST_SRC" "$PLIST_DIR/$LABEL.plist"
chown root:wheel "$PLIST_DIR/$LABEL.plist" 2>/dev/null || true
chmod 644 "$PLIST_DIR/$LABEL.plist"

say "重新加载守护进程"
launchctl bootout system/"$LABEL" 2>/dev/null || true
if ! launchctl bootstrap system "$PLIST_DIR/$LABEL.plist" 2>/dev/null; then
  echo "    bootstrap 失败，改用 legacy load"
  launchctl load -w "$PLIST_DIR/$LABEL.plist" 2>/dev/null || true
fi

say "健康检查（最多等 20 秒）"
for i in $(seq 1 20); do
  sleep 1
  OUT="$(curl -s --max-time 2 http://127.0.0.1:3065/health 2>/dev/null || true)"
  if echo "$OUT" | grep -q '"ok"'; then
    echo "    ✅ $OUT"
    say "完成。打开 App → 网关插件 → 下载并安装"
    echo "    日志：$DATA/server.log"
    echo "    重启：launchctl kickstart -k system/$LABEL"
    exit 0
  fi
  printf '.'
done

echo
die "网关没起来。排查：
  1) launchctl print system/$LABEL | head -40    # 看 last exit reason
  2) tail -60 $DATA/server.log
  3) codesigning 被杀 → ldid -S $BIN_DIR/agent2api-server 后 kickstart
  4) 端口被占 → lsof -i :3065（或改 plist 里的 AGENT2API_PROXY_PORT）"
