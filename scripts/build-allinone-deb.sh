#!/usr/bin/env bash
# ── 一次装完的 .deb：App（桌面） + 网关守护进程 + LaunchDaemon + 面板资源 ──
#
# 支持两种越狱布局（用 --prefix 选择）：
#   rootless（Dopamine / palera1n rootless）: --prefix /var/jb
#   rootful （Relaxin / unc0ver / checkra1n）: --prefix ""（装到根 /）
#
# 架构（--arch）：
#   iphoneos-arm64（默认）/ iphoneos-arm64e / both
#   arm64e 机器的 dpkg 认 iphoneos-arm64e；同一份 Mach-O（arm64 ABI）在
#   arm64e 设备上原生可跑，所以这里只换 control 的 Architecture 字段，
#   一次编译直接出两种包，不用事后手工转换。
set -euo pipefail

APP=""
UI_SRC=""
BIN=""
PLIST=""
ENTS=""
DAEMON_ENTS=""
PACKS=""
PREFIX="/var/jb"
VERSION="0.0.0"
ARCH="iphoneos-arm64"
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
    --packs)        PACKS="$2"; shift 2 ;;
    --prefix)       PREFIX="$2"; shift 2 ;;
    --arch)         ARCH="$2"; shift 2 ;;
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
if [ -n "$PREFIX" ]; then
  cp "$PLIST" "$ROOT$PREFIX/Library/LaunchDaemons/${PKG}.plist"
else
  # rootful：plist 里的 ProgramArguments / 数据目录都写着 /var/jb/...，
  # 直接照抄会让 launchd 去 exec 一个不存在的路径（装完 daemon 起不来）。
  sed 's#/var/jb##g' "$PLIST" > "$ROOT/Library/LaunchDaemons/${PKG}.plist"
fi
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

# ── 预置插件包 ──────────────────────────────────────────────────────────
# 面板里的"网关插件"是走 GitHub 下载 + ed25519 验签的；自建包没有官方签名，
# 在国内网络下又只能走加速镜像（镜像通道强制验签），所以点下载必然爆红。
# 把已编译好的插件目录直接装进 deb，postinst 落到网关的 plugins/ 目录并写
# 注册表 —— 装上就有，不依赖网络，也不碰签名那条路径。
if [ -n "$PACKS" ] && [ -d "$PACKS" ]; then
  echo "==> 预置插件包"
  mkdir -p "$ROOT$PREFIX/usr/local/share/agent2api/packs"
  cp -R "$PACKS"/. "$ROOT$PREFIX/usr/local/share/agent2api/packs"/
  echo "    插件包数：$(find "$ROOT$PREFIX/usr/local/share/agent2api/packs" -name pack.json -maxdepth 3 | wc -l | tr -d ' ')"
else
  if [ -n "$PACKS" ]; then echo "WARN: --packs 目录不存在：$PACKS"; fi
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

# control 里唯一的架构差异就是 Architecture，逐架构重写一次
write_control() {
  cat > "$ROOT/DEBIAN/control" <<EOF
Package: ${PKG}
Name: Agent2API
Version: ${VERSION}
Architecture: $1
Description: Agent2API gateway + panel (app + launchd daemon)
Maintainer: vbox-Ai
Author: vbox-Ai
Section: Applications
Depends: firmware (>= 15.0), ldid
Installed-Size: ${SIZE}
EOF
}

cat > "$ROOT/DEBIAN/postinst" <<EOF
#!/bin/sh
set -u
PKG="com.chiyu.agent2api"
PREFIX="${PREFIX}"

# ── 解析真实根（RootHide / roothide）────────────────────────────────
# RootHide 把 dpkg 的根重定向到
#   /private/var/containers/Bundle/Application/.jbroot-<random>/
# 系统里既没有 /var/jb，也没有真正的 /usr/local：安装时 dpkg 会把无前缀
# 路径统统落进 .jbroot-*。但 plist 里的 ProgramArguments 是**绝对路径
# 字符串**，launchd 不会替你翻译，于是 exec 失败、面板永远
# 「网关未响应 127.0.0.1:3065」。
# 判定：① 本脚本自身路径里的 /var/lib/dpkg 前缀 ② 现成的 .jbroot-* 目录
# 命中后直接把 PREFIX 切成 jbroot —— 后面所有 \${PREFIX}/... 路径自动跟上。
JB=""
SELF="\$0"
case "\$SELF" in
  /*) ;;
  *) SELF="\$(cd "\$(dirname "\$SELF")" 2>/dev/null && pwd)/\$(basename "\$SELF")" ;;
esac
case "\$SELF" in
  */var/lib/dpkg/*) JB="\${SELF%%/var/lib/dpkg/*}" ;;
esac
if [ -z "\$JB" ] || [ ! -d "\$JB" ]; then
  JB=""
  for cand in /private/var/containers/Bundle/Application/.jbroot-* \
              /var/containers/Bundle/Application/.jbroot-*; do
    if [ -d "\$cand/usr/local/bin" ]; then JB="\$cand"; break; fi
  done
fi
# 只对"无前缀"（rootful 语义）的包改写；rootless 包已自带 /var/jb
if [ -n "\$JB" ] && [ -z "\${PREFIX}" ]; then
  PREFIX="\$JB"
  echo "[agent2api] jbroot: \$JB"
fi

APP="\${PREFIX}/Applications/Agent2API.app"
BIN="\${PREFIX}/usr/local/bin/agent2api-server"
PLIST="\${PREFIX}/Library/LaunchDaemons/\${PKG}.plist"
DATA="\${PREFIX}/usr/local/var/agent2api"

echo "[agent2api] layout: \${PREFIX:-/ (rootful)}"

# plist 里的绝对路径同样要落到真实根下，否则 launchd exec 不到
if [ -n "\$JB" ] && [ -f "\$PLIST" ]; then
  sed -e "s#>\/usr\/local/#>\$JB\/usr\/local/#g" "\$PLIST" > "\$PLIST.tmp" 2>/dev/null \
    && mv "\$PLIST.tmp" "\$PLIST"
fi

mkdir -p "\$DATA"
chown mobile:mobile "\$DATA" 2>/dev/null || true
chmod 700 "\$DATA" 2>/dev/null || true

# 预置插件：把 deb 里带的插件目录放进网关的 plugins/，并写注册表。
# 注册表是"装了哪些包"的唯一来源（网关不会自己扫目录），所以必须带 plugins.json。
PACKDIR="\${PREFIX}/usr/local/share/agent2api/packs"
if [ -d "\$PACKDIR" ]; then
  echo "[agent2api] 预置插件"
  mkdir -p "\$DATA/plugins"
  for one in "\$PACKDIR"/*; do
    [ -d "\$one" ] || continue
    id="\$(basename "\$one")"
    rm -rf "\$DATA/plugins/\$id"
    cp -R "\$one" "\$DATA/plugins/\$id"
    echo "[agent2api]   pack: \$id"
  done
  if [ -f "\$PACKDIR/plugins.json" ]; then
    if [ -f "\$DATA/plugins/plugins.json" ]; then
      cp "\$DATA/plugins/plugins.json" "\$DATA/plugins/plugins.json.bak.\$(date +%s)"
    fi
    cp "\$PACKDIR/plugins.json" "\$DATA/plugins/plugins.json"
  fi
  chown -R mobile:mobile "\$DATA/plugins" 2>/dev/null || true
  chmod -R 755 "\$DATA/plugins" 2>/dev/null || true
fi

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
  # 必须显式带环境：否则 daemon 会把数据写到 cwd 下的 ./.agent2api
  (
    AGENT2API_PROXY_HOME="\$DATA" \
    AGENT2API_UI_DIR="\${PREFIX}/usr/local/share/agent2api/ui" \
    AGENT2API_HOST=127.0.0.1 \
    AGENT2API_PROXY_PORT=3065 \
    AGENT2API_ALLOW_EXEC=1 \
    AGENT2API_SELF_UPDATE=0 \
    nohup "\$BIN" >>"\$DATA/server.log" 2>&1 &
  ) 2>/dev/null || true
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

case "$ARCH" in
  both|all|"") ARCH_LIST="iphoneos-arm64 iphoneos-arm64e" ;;
  *) ARCH_LIST="$(printf '%s' "$ARCH" | tr ',' ' ')" ;;
esac

for A in $ARCH_LIST; do
  write_control "$A"
  DEB="$OUT/Agent2API-${VERSION}-${SUFFIX}-${A}.deb"
  rm -f "$DEB"
  dpkg-deb -b --root-owner-group "$ROOT" "$DEB" >/dev/null
  echo "==> 产出：$DEB ($(du -h "$DEB" | cut -f1))"
done
