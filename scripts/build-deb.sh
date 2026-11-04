#!/usr/bin/env bash
# ── 把 daemon 打成一个 rootless .deb（Sileo / Zebra / Filza 点装，无需终端）────
#
# 装完即生效：postinst 会做 ldid 签名 → 建数据目录 → launchctl bootstrap → 健康检查。
# 卸载时 prerm 会 bootout，避免留下"占着端口却没人管"的进程。
#
# 用法（在 ubuntu/CI 上跑，需要 dpkg-deb）：
#   ./scripts/build-deb.sh --binary out/ios/agent2api-server \
#       --plist out/ios/com.chiyu.agent2api.plist --version 3.4.0 --out out/deb
set -euo pipefail

BIN=""
PLIST=""
VERSION="3.4.0"
OUT="out/deb"
UI_SRC=""
PKG="com.chiyu.agent2api"
LABEL="com.chiyu.agent2api"

while [ $# -gt 0 ]; do
  case "$1" in
    --binary)  BIN="$2"; shift 2 ;;
    --plist)   PLIST="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --out)     OUT="$2"; shift 2 ;;
    --ui)      UI_SRC="$2"; shift 2 ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

[ -f "$BIN" ]   || { echo "找不到二进制：$BIN"; exit 1; }
[ -f "$PLIST" ] || { echo "找不到 plist：$PLIST"; exit 1; }
command -v dpkg-deb >/dev/null || { echo "缺少 dpkg-deb"; exit 1; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

# rootless 布局：文件放在 var/jb/...（dpkg 解包到 /）
install -Dm755 "$BIN"   "$ROOT/var/jb/usr/local/bin/agent2api-server"
install -Dm644 "$PLIST" "$ROOT/var/jb/Library/LaunchDaemons/${LABEL}.plist"
mkdir -p "$ROOT/DEBIAN"

INSTALLED_SIZE=$(( $(stat -c%s "$BIN") / 1024 ))
cat > "$ROOT/DEBIAN/control" <<EOF
Package: ${PKG}
Name: Agent2API Gateway Daemon
Version: ${VERSION}
Architecture: iphoneos-arm64
Description: Agent2API 网关守护进程（iOS 原生 Mach-O，支持原生插件 provider）
Maintainer: vbox-Ai
Author: vbox-Ai
Section: Tweaks
Depends: firmware (>= 15.0), ldid
Installed-Size: ${INSTALLED_SIZE}
EOF

cat > "$ROOT/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -u
LABEL="com.chiyu.agent2api"
BIN="/var/jb/usr/local/bin/agent2api-server"
PLIST="/var/jb/Library/LaunchDaemons/${LABEL}.plist"
DATA="/var/mobile/Library/agent2api"

echo "[agent2api] 数据目录"
mkdir -p "$DATA"
chown mobile:mobile "$DATA" 2>/dev/null || true
chmod 700 "$DATA" 2>/dev/null || true

echo "[agent2api] 签名"
if command -v ldid >/dev/null 2>&1; then
  ldid -S "$BIN" || echo "[agent2api] WARN: ldid 签名失败"
else
  echo "[agent2api] WARN: 未安装 ldid（apt install ldid）"
fi
chmod 755 "$BIN"

echo "[agent2api] 加载守护进程"
launchctl bootout system/"$LABEL" 2>/dev/null || true
if ! launchctl bootstrap system "$PLIST" 2>/dev/null; then
  echo "[agent2api] bootstrap 失败，尝试 legacy load"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST" 2>/dev/null || true
fi

echo "[agent2api] 健康检查"
i=0
while [ $i -lt 20 ]; do
  i=$((i + 1))
  sleep 1
  if curl -s --max-time 2 http://127.0.0.1:3065/health 2>/dev/null | grep -q '"ok"'; then
    echo "[agent2api] ✅ 网关已就绪：http://127.0.0.1:3065/"
    exit 0
  fi
done

echo "[agent2api] ⚠ 网关未在 20 秒内就绪，请查看：tail -50 $DATA/server.log"
echo "[agent2api]   常见原因：ldid 未签名 / plist 端口被占 / 数据目录权限"
exit 0
EOF

cat > "$ROOT/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -u
LABEL="com.chiyu.agent2api"
PLIST="/var/jb/Library/LaunchDaemons/${LABEL}.plist"
launchctl bootout system/"$LABEL" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
exit 0
EOF

chmod 755 "$ROOT/DEBIAN/postinst" "$ROOT/DEBIAN/prerm"

if [ -n "$UI_SRC" ] && [ -d "$UI_SRC" ]; then
  install_dir="$ROOT/var/jb/usr/local/share/agent2api/ui"
  mkdir -p "$install_dir"
  cp -R "$UI_SRC"/. "$install_dir"/
  echo "面板文件数：$(find "$install_dir" -type f | wc -l | tr -d ' ')"
fi

mkdir -p "$OUT"
DEB="$OUT/${PKG}_${VERSION}_iphoneos-arm64.deb"
dpkg-deb -b --root-owner-group "$ROOT" "$DEB" >/dev/null
echo "==> 产出：$DEB ($(du -h "$DEB" | cut -f1))"
dpkg-deb -I "$DEB" | sed -n '1,20p'
