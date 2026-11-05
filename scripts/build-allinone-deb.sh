#!/usr/bin/env bash
# ── 一次装完的 .deb：App（桌面） + 网关守护进程 + LaunchDaemon + 面板资源 ──
#
# 支持两种越狱布局（用 --prefix 选择）：
#   rootless（Dopamine / palera1n rootless）: --prefix /var/jb
#   rootful （Relaxin / unc0ver / checkra1n）: --prefix ""（装到根 /）
set -euo pipefail

APP=""
UI_SRC=""
BIN=""
PLIST=""
ENTS=""
DAEMON_ENTS=""
PREFIX="/var/jb"
VERSION="0.0.0"
OUT="out/deb"
PKG="com.chiyu.agent2api"

while [ $# -gt 0 ]; do
  case "$1" in
    --app)          APP="$2"; shift 2 ;;
    --binary)       BIN="$2"; shift 2 ;;
    --plist)        PLIST="$2"; shift 2 ;;
    --entitlements) ENTS="$2"; shift 2 ;;
    --daemon-entitlements) DAEMON_ENTS="$2"; shift 2 ;;
    --ui)           UI_SRC="$2"; shift 2 ;;
    --prefix)       PREFIX="$2"; shift 2 ;;
    --version)      VERSION="$2"; shift 2 ;;
    --out)          OUT="$2"; shift 2 ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

[ -d "$APP" ]   || { echo "找不到 App bundle：$APP"; exit 1; }
[ -f "$BIN" ]   || { echo "找不到守护进程：$BIN"; exit 1; }
[ -f "$PLIST" ] || { echo "找不到 plist：$PLIST"; exit 1; }
[ -f "$ENTS" ]  || { echo "找不到 entitlements：$ENTS"; exit 1; }
command -v dpkg-deb >/dev/null || { echo "缺少 dpkg-deb（brew install dpkg）"; exit 1; }

PREFIX="${PREFIX%/}"
case "$PREFIX" in "/"|".") PREFIX="" ;; esac
if [ -n "$PREFIX" ]; then echo "==> 目标布局：rootless（${PREFIX}）"; else echo "==> 目标布局：rootful（/）"; fi

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

echo "==> 组装 App"
mkdir -p "$ROOT$PREFIX/Applications"
cp -R "$APP" "$ROOT$PREFIX/Applications/Agent2API.app" || { echo "❌ 拷贝 App 失败"; exit 1; }
APP_BIN="$ROOT$PREFIX/Applications/Agent2API.app/Agent2API"
[ -f "$APP_BIN" ] || { echo "App 主二进制缺失：$APP_BIN"; exit 1; }

echo "==> 组装守护进程"
mkdir -p "$ROOT$PREFIX/usr/local/bin"
cp "$BIN" "$ROOT$PREFIX/usr/local/bin/agent2api-server"
chmod 755 "$ROOT$PREFIX/usr/local/bin/agent2api-server"
mkdir -p "$ROOT$PREFIX/Library/LaunchDaemons"
cp "$PLIST" "$ROOT$PREFIX/Library/LaunchDaemons/${PKG}.plist"
chmod 644 "$ROOT$PREFIX/Library/LaunchDaemons/${PKG}.plist"

if [ -n "$UI_SRC" ] && [ -d "$UI_SRC" ]; then
  echo "==> 安装面板资源"
  mkdir -p "$ROOT$PREFIX/usr/local/share/agent2api/ui"
  cp -R "$UI_SRC"/. "$ROOT$PREFIX/usr/local/share/agent2api/ui"/
  mkdir -p "$ROOT$PREFIX/usr/local/bin/ui"
  cp -R "$UI_SRC"/. "$ROOT$PREFIX/usr/local/bin/ui"/
  echo "    面板文件数：$(find "$ROOT$PREFIX/usr/local/share/agent2api/ui" -type f | wc -l | tr -d ' ')"
else
  echo "WARN: 没有提供 --ui，/m 会 404"
fi

echo "==> 签名"
if command -v ldid >/dev/null 2>&1; then
  ldid -S"$ENTS" "$APP_BIN"
  # 守护进程同样带上 platform-application：RootHide / 部分越狱要求
  # 二进制有平台级签名，launchd 才肯 exec 它（否则进程起不来、health 永远失败）。
  if [ -n "$DAEMON_ENTS" ] && [ -f "$DAEMON_ENTS" ]; then
    ldid -S"$DAEMON_ENTS" "$ROOT$PREFIX/usr/local/bin/agent2api-server"
  else
    ldid -S "$ROOT$PREFIX/usr/local/bin/agent2api-server"
  fi
else
  echo "WARN: 没有 ldid，跳过签名"
fi

mkdir -p "$ROOT/DEBIAN"
SIZE=$(( $(du -sk "$ROOT" | cut -f1) ))
cat > "$ROOT/DEBIAN/control" <<EOF
Package: ${PKG}
Name: Agent2API
Version: ${VERSION}
Architecture: iphoneos-arm64
Description: Agent2API gateway + panel (app + launchd daemon)
Maintainer: vbox-Ai
Author: vbox-Ai
Section: Applications
Depends: firmware (>= 15.0), ldid
Installed-Size: ${SIZE}
EOF

cat > "$ROOT/DEBIAN/postinst" <<EOF
#!/bin/sh
set -u
PKG="com.chiyu.agent2api"
PREFIX="${PREFIX}"
APP="\${PREFIX}/Applications/Agent2API.app"
BIN="\${PREFIX}/usr/local/bin/agent2api-server"
PLIST="\${PREFIX}/Library/LaunchDaemons/\${PKG}.plist"
DATA="\${PREFIX}/usr/local/var/agent2api"

echo "[agent2api] layout: \${PREFIX:-/ (rootful)}"
mkdir -p "\$DATA"
chown mobile:mobile "\$DATA" 2>/dev/null || true
chmod 700 "\$DATA" 2>/dev/null || true

chmod -R 755 "\$APP" 2>/dev/null || true
chown -R root:wheel "\$APP" 2>/dev/null || true
chmod 755 "\$BIN" 2>/dev/null || true

echo "[agent2api] register app"
if command -v uicache >/dev/null 2>&1; then
  uicache -p "\$APP" 2>/dev/null || uicache -a 2>/dev/null || true
fi

UI_DIR="\${PREFIX}/usr/local/share/agent2api/ui"
if [ -d "\$UI_DIR" ]; then
  echo "[agent2api]   ui files: \$(find "\$UI_DIR" -type f | wc -l | tr -d ' ')"
else
  echo "[agent2api]   WARN missing \$UI_DIR"
fi

echo "[agent2api] stop old"
launchctl bootout system/"\$PKG" 2>/dev/null || true
launchctl unload "\$PLIST" 2>/dev/null || true
killall -9 agent2api-server 2>/dev/null || true
sleep 1

echo "[agent2api] bootstrap"
launchctl enable system/"\$PKG" 2>/dev/null || true
if ! launchctl bootstrap system "\$PLIST" 2>/dev/null; then
  launchctl kickstart -k system/"\$PKG" 2>/dev/null || launchctl load -w "\$PLIST" 2>/dev/null || true
fi

echo "[agent2api] health check"
i=0
while [ \$i -lt 20 ]; do
  i=\$((i + 1))
  sleep 1
  if curl -s --max-time 2 http://127.0.0.1:3065/health 2>/dev/null | grep -q '"ok"'; then
    echo "[agent2api] OK gateway ready"
    exit 0
  fi
done
echo "[agent2api] launchd 没拉起来，改为直接后台启动（本次开机内有效）"
if [ -x "\$BIN" ]; then
  ( nohup "\$BIN" >>"\$DATA/server.log" 2>&1 & ) 2>/dev/null || true
  sleep 4
  if curl -s --max-time 2 http://127.0.0.1:3065/health 2>/dev/null | grep -q '"ok"'; then
    echo "[agent2api] OK gateway ready (direct start)"
    exit 0
  fi
fi
echo "[agent2api] WARN gateway not ready, see \$DATA/server.log"
exit 0
EOF

cat > "$ROOT/DEBIAN/prerm" <<EOF
#!/bin/sh
set -u
PKG="com.chiyu.agent2api"
PREFIX="${PREFIX}"
PLIST="\${PREFIX}/Library/LaunchDaemons/\${PKG}.plist"
launchctl bootout system/"\$PKG" 2>/dev/null || true
launchctl unload "\$PLIST" 2>/dev/null || true
exit 0
EOF

chmod 755 "$ROOT/DEBIAN/postinst" "$ROOT/DEBIAN/prerm"

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
SUFFIX=rootful
[ -n "$PREFIX" ] && SUFFIX=rootless
DEB="$OUT/Agent2API-${VERSION}-${SUFFIX}.deb"
dpkg-deb -b --root-owner-group "$ROOT" "$DEB" >/dev/null
echo "==> 产出：$DEB"
