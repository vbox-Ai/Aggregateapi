#!/usr/bin/env bash
# ── 一次装完的 rootless .deb：App（/Applications） + 网关守护进程 + LaunchDaemon ──
#
# 用户在 Sileo / Zebra / Filza 里**点一个文件**装完，就得到：
#   /Applications/Agent2API.app           面板（沙盒/平台应用 → WKWebView 正常）
#   /var/jb/usr/local/bin/agent2api-server 网关守护进程（无沙盒 → 可 exec 插件）
#   /var/jb/Library/LaunchDaemons/com.chiyu.agent2api.plist
# postinst 自动：ldid 签名 → uicache 注册 App → bootstrap 守护进程 → /health 自检
#
# 用法（在 macOS runner 上跑，需 brew install dpkg ldid）：
#   ./scripts/build-allinone-deb.sh \
#       --app agent2api-ios/build/Payload/Agent2API.app \
#       --binary out/ios/agent2api-server \
#       --plist out/ios/com.chiyu.agent2api.plist \
#       --entitlements agent2api-ios/app/Agent2API/entitlements-platform.plist \
#       --version 3.4.65 --out out/deb
set -euo pipefail

APP=""
BIN=""
PLIST=""
ENTS=""
VERSION="0.0.0"
OUT="out/deb"
PKG="com.chiyu.agent2api"

while [ $# -gt 0 ]; do
  case "$1" in
    --app)          APP="$2"; shift 2 ;;
    --binary)       BIN="$2"; shift 2 ;;
    --plist)        PLIST="$2"; shift 2 ;;
    --entitlements) ENTS="$2"; shift 2 ;;
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

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

echo "==> 组装 App（/Applications）"
mkdir -p "$ROOT/Applications"
cp -R "$APP" "$ROOT/Applications/Agent2API.app"
APP_BIN="$ROOT/Applications/Agent2API.app/Agent2API"
[ -f "$APP_BIN" ] || { echo "App 主二进制缺失：$APP_BIN"; exit 1; }

echo "==> 组装守护进程"
install -Dm755 "$BIN"   "$ROOT/var/jb/usr/local/bin/agent2api-server"
install -Dm644 "$PLIST" "$ROOT/var/jb/Library/LaunchDaemons/${PKG}.plist"

echo "==> 签名（App 用 platform-application，daemon 用最小签名）"
if command -v ldid >/dev/null 2>&1; then
  ldid -S"$ENTS" "$APP_BIN"
  ldid -S "$ROOT/var/jb/usr/local/bin/agent2api-server"
else
  echo "WARN: 没有 ldid，跳过签名（装到设备后 AMFI 可能拒绝运行）"
fi

mkdir -p "$ROOT/DEBIAN"
SIZE=$(( ($(du -sk "$ROOT/Applications" | cut -f1)) + ($(du -sk "$ROOT/var" | cut -f1)) ))
cat > "$ROOT/DEBIAN/control" <<EOF
Package: ${PKG}
Name: Agent2API
Version: ${VERSION}
Architecture: iphoneos-arm64
Description: Agent2API 网关 + 面板（一次安装：/Applications App + LaunchDaemon 网关，插件原生运行）
Maintainer: vbox-Ai
Author: vbox-Ai
Section: Applications
Depends: firmware (>= 15.0), ldid
Installed-Size: ${SIZE}
EOF

cat > "$ROOT/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -u
PKG="com.chiyu.agent2api"
APP="/Applications/Agent2API.app"
BIN="/var/jb/usr/local/bin/agent2api-server"
PLIST="/var/jb/Library/LaunchDaemons/${PKG}.plist"
DATA="/var/mobile/Library/agent2api"

echo "[agent2api] 数据目录"
mkdir -p "$DATA"
chown mobile:mobile "$DATA" 2>/dev/null || true
chmod 700 "$DATA" 2>/dev/null || true

echo "[agent2api] 权限"
chmod -R 755 "$APP" 2>/dev/null || true
chmod 755 "$BIN" 2>/dev/null || true
chown -R root:wheel "$APP" 2>/dev/null || true

echo "[agent2api] 注册 App"
if command -v uicache >/dev/null 2>&1; then
  uicache -p "$APP" 2>/dev/null || uicache -a 2>/dev/null || true
else
  echo "[agent2api] WARN: 没有 uicache，请手动 respring"
fi

echo "[agent2api] 加载守护进程"
launchctl bootout system/"$PKG" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
if ! launchctl bootstrap system "$PLIST" 2>/dev/null; then
  launchctl load -w "$PLIST" 2>/dev/null || true
fi

echo "[agent2api] 健康检查"
i=0
while [ $i -lt 20 ]; do
  i=$((i + 1))
  sleep 1
  if curl -s --max-time 2 http://127.0.0.1:3065/health 2>/dev/null | grep -q '"ok"'; then
    echo "[agent2api] ✅ 网关已就绪；打开桌面上的 Agent2API 即可"
    exit 0
  fi
done
echo "[agent2api] ⚠ 网关未在 20 秒内就绪：tail -50 $DATA/server.log"
exit 0
EOF

cat > "$ROOT/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -u
PKG="com.chiyu.agent2api"
PLIST="/var/jb/Library/LaunchDaemons/${PKG}.plist"
launchctl bootout system/"$PKG" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
if command -v uicache >/dev/null 2>&1; then
  uicache -a 2>/dev/null || true
fi
exit 0
EOF

chmod 755 "$ROOT/DEBIAN/postinst" "$ROOT/DEBIAN/prerm"

mkdir -p "$OUT"
DEB="$OUT/${PKG}_${VERSION}_iphoneos-arm64.deb"
dpkg-deb -b --root-owner-group "$ROOT" "$DEB" >/dev/null
echo "==> 产出：$DEB ($(du -h "$DEB" | cut -f1))"
dpkg-deb -c "$DEB" | sed -n '1,12p'
