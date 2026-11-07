#!/usr/bin/env bash
# 鈹€鈹€ 涓€娆¤瀹岀殑 .deb锛欰pp锛堟闈級 + 缃戝叧瀹堟姢杩涚▼ + LaunchDaemon + 闈㈡澘璧勬簮 鈹€鈹€
#
# 鏀寔涓ょ瓒婄嫳甯冨眬锛堢敤 --prefix 閫夋嫨锛夛細
#   rootless锛圖opamine / palera1n rootless锛? --prefix /var/jb
#   rootful 锛圧elaxin / unc0ver / checkra1n锛? --prefix ""锛堣鍒版牴 /锛?#
# 鏋舵瀯锛?-arch锛夛細
#   iphoneos-arm64锛堥粯璁わ級/ iphoneos-arm64e / both
#   arm64e 鏈哄櫒鐨?dpkg 璁?iphoneos-arm64e锛涘悓涓€浠?Mach-O锛坅rm64 ABI锛夊湪
#   arm64e 璁惧涓婂師鐢熷彲璺戯紝鎵€浠ヨ繖閲屽彧鎹?control 鐨?Architecture 瀛楁锛?#   涓€娆＄紪璇戠洿鎺ュ嚭涓ょ鍖咃紝涓嶇敤浜嬪悗鎵嬪伐杞崲銆?set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

APP=""
UI_SRC=""
BIN=""
SUPERVISOR=""
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
    --supervisor)   SUPERVISOR="$2"; shift 2 ;;
    --plist)        PLIST="$2"; shift 2 ;;
    --entitlements) ENTS="$2"; shift 2 ;;
    --daemon-entitlements) DAEMON_ENTS="$2"; shift 2 ;;
    --ui)           UI_SRC="$2"; shift 2 ;;
    --packs)        PACKS="$2"; shift 2 ;;
    --prefix)       PREFIX="$2"; shift 2 ;;
    --arch)         ARCH="$2"; shift 2 ;;
    --version)      VERSION="$2"; shift 2 ;;
    --out)          OUT="$2"; shift 2 ;;
    *) echo "鏈煡鍙傛暟锛?1"; exit 2 ;;
  esac
done

[ -d "$APP" ]   || { echo "鎵句笉鍒?App bundle锛?APP"; exit 1; }
[ -f "$BIN" ]   || { echo "鎵句笉鍒板畧鎶よ繘绋嬶細$BIN"; exit 1; }
[ -f "$SUPERVISOR" ] || { echo "鎵句笉鍒?supervisor锛?SUPERVISOR"; exit 1; }
[ -f "$PLIST" ] || { echo "鎵句笉鍒?plist锛?PLIST"; exit 1; }
[ -f "$ENTS" ]  || { echo "鎵句笉鍒?entitlements锛?ENTS"; exit 1; }
command -v dpkg-deb >/dev/null || { echo "缂哄皯 dpkg-deb锛坆rew install dpkg锛?; exit 1; }

PREFIX="${PREFIX%/}"
case "$PREFIX" in "/"|".") PREFIX="" ;; esac
if [ -n "$PREFIX" ]; then echo "==> 鐩爣甯冨眬锛歳ootless锛?{PREFIX}锛?; else echo "==> 鐩爣甯冨眬锛歳ootful锛?锛?; fi

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

echo "==> 缁勮 App"
mkdir -p "$ROOT$PREFIX/Applications"
cp -R "$APP" "$ROOT$PREFIX/Applications/Agent2API.app" || { echo "鉂?鎷疯礉 App 澶辫触"; exit 1; }
APP_BIN="$ROOT$PREFIX/Applications/Agent2API.app/Agent2API"
[ -f "$APP_BIN" ] || { echo "App 涓讳簩杩涘埗缂哄け锛?APP_BIN"; exit 1; }

echo "==> 缁勮瀹堟姢杩涚▼"
mkdir -p "$ROOT$PREFIX/usr/local/bin"
cp "$BIN" "$ROOT$PREFIX/usr/local/bin/agent2api-server"
cp "$SUPERVISOR" "$ROOT$PREFIX/usr/local/bin/agent2api-supervisor"
cp "$REPO_ROOT/agent2api-ios/daemon/agent2api-launch.sh" \
   "$ROOT$PREFIX/usr/local/bin/agent2api-launch"
chmod 755 "$ROOT$PREFIX/usr/local/bin/agent2api-server" \
          "$ROOT$PREFIX/usr/local/bin/agent2api-supervisor" \
          "$ROOT$PREFIX/usr/local/bin/agent2api-launch"
mkdir -p "$ROOT$PREFIX/Library/LaunchDaemons"
if [ -n "$PREFIX" ]; then
  cp "$PLIST" "$ROOT$PREFIX/Library/LaunchDaemons/${PKG}.plist"
else
  # rootful锛歱list 閲岀殑 ProgramArguments / 鏁版嵁鐩綍閮藉啓鐫€ /var/jb/...锛?  # 鐩存帴鐓ф妱浼氳 launchd 鍘?exec 涓€涓笉瀛樺湪鐨勮矾寰勶紙瑁呭畬 daemon 璧蜂笉鏉ワ級銆?  sed 's#/var/jb##g' "$PLIST" > "$ROOT/Library/LaunchDaemons/${PKG}.plist"
fi
chmod 644 "$ROOT$PREFIX/Library/LaunchDaemons/${PKG}.plist"

if [ -n "$UI_SRC" ] && [ -d "$UI_SRC" ]; then
  echo "==> 瀹夎闈㈡澘璧勬簮"
  mkdir -p "$ROOT$PREFIX/usr/local/share/agent2api/ui"
  cp -R "$UI_SRC"/. "$ROOT$PREFIX/usr/local/share/agent2api/ui"/
  mkdir -p "$ROOT$PREFIX/usr/local/bin/ui"
  cp -R "$UI_SRC"/. "$ROOT$PREFIX/usr/local/bin/ui"/
  echo "    闈㈡澘鏂囦欢鏁帮細$(find "$ROOT$PREFIX/usr/local/share/agent2api/ui" -type f | wc -l | tr -d ' ')"
else
  echo "WARN: 娌℃湁鎻愪緵 --ui锛?m 浼?404"
fi

# 鈹€鈹€ 棰勭疆鎻掍欢鍖?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
# 闈㈡澘閲岀殑"缃戝叧鎻掍欢"鏄蛋 GitHub 涓嬭浇 + ed25519 楠岀鐨勶紱鑷缓鍖呮病鏈夊畼鏂圭鍚嶏紝
# 鍦ㄥ浗鍐呯綉缁滀笅鍙堝彧鑳借蛋鍔犻€熼暅鍍忥紙闀滃儚閫氶亾寮哄埗楠岀锛夛紝鎵€浠ョ偣涓嬭浇蹇呯劧鐖嗙孩銆?# 鎶婂凡缂栬瘧濂界殑鎻掍欢鐩綍鐩存帴瑁呰繘 deb锛宲ostinst 钀藉埌缃戝叧鐨?plugins/ 鐩綍骞跺啓
# 娉ㄥ唽琛?鈥斺€?瑁呬笂灏辨湁锛屼笉渚濊禆缃戠粶锛屼篃涓嶇绛惧悕閭ｆ潯璺緞銆?if [ -n "$PACKS" ] && [ -d "$PACKS" ]; then
  echo "==> 棰勭疆鎻掍欢鍖?
  mkdir -p "$ROOT$PREFIX/usr/local/share/agent2api/packs"
  cp -R "$PACKS"/. "$ROOT$PREFIX/usr/local/share/agent2api/packs"/
  echo "    鎻掍欢鍖呮暟锛?(find "$ROOT$PREFIX/usr/local/share/agent2api/packs" -name pack.json -maxdepth 3 | wc -l | tr -d ' ')"
else
  if [ -n "$PACKS" ]; then echo "WARN: --packs 鐩綍涓嶅瓨鍦細$PACKS"; fi
fi

echo "==> 绛惧悕"
if command -v ldid >/dev/null 2>&1; then
  ldid -S"$ENTS" "$APP_BIN"
  # 瀹堟姢杩涚▼鍚屾牱甯︿笂 platform-application锛歊ootHide / 閮ㄥ垎瓒婄嫳瑕佹眰
  # 浜岃繘鍒舵湁骞冲彴绾х鍚嶏紝launchd 鎵嶈偗 exec 瀹冿紙鍚﹀垯杩涚▼璧蜂笉鏉ャ€乭ealth 姘歌繙澶辫触锛夈€?  if [ -n "$DAEMON_ENTS" ] && [ -f "$DAEMON_ENTS" ]; then
    ldid -S"$DAEMON_ENTS" "$ROOT$PREFIX/usr/local/bin/agent2api-server"
  else
    ldid -S "$ROOT$PREFIX/usr/local/bin/agent2api-server"
  fi
  if [ -n "$DAEMON_ENTS" ] && [ -f "$DAEMON_ENTS" ]; then
    ldid -S"$DAEMON_ENTS" "$ROOT$PREFIX/usr/local/bin/agent2api-supervisor"
  else
    ldid -S "$ROOT$PREFIX/usr/local/bin/agent2api-supervisor"
  fi
else
  echo "WARN: 娌℃湁 ldid锛岃烦杩囩鍚?
fi

mkdir -p "$ROOT/DEBIAN"
SIZE=$(( $(du -sk "$ROOT" | cut -f1) ))

# control 閲屽敮涓€鐨勬灦鏋勫樊寮傚氨鏄?Architecture锛岄€愭灦鏋勯噸鍐欎竴娆?write_control() {
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

cp "$REPO_ROOT/agent2api-ios/daemon/preinst.sh"  "$ROOT/DEBIAN/preinst"
cp "$REPO_ROOT/agent2api-ios/daemon/postinst.sh" "$ROOT/DEBIAN/postinst"
cp "$REPO_ROOT/agent2api-ios/daemon/prerm.sh"    "$ROOT/DEBIAN/prerm"
cp "$REPO_ROOT/agent2api-ios/daemon/postrm.sh"   "$ROOT/DEBIAN/postrm"
chmod 755 "$ROOT/DEBIAN/preinst" "$ROOT/DEBIAN/postinst" "$ROOT/DEBIAN/prerm" "$ROOT/DEBIAN/postrm"

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
  echo "==> 浜у嚭锛?DEB ($(du -h "$DEB" | cut -f1))"
done
