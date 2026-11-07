#!/bin/bash
# 鈹€鈹€ Agent2API 路 iOS IPA 鏋勫缓鑴氭湰锛坢acOS 涓婅窇锛夆攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
# 涓ゆ潯褰㈡€侊細
#   EMBED=0锛堥粯璁わ級绾鎴风澹筹細涓嶉摼鎺?Rust锛屽彧鍋氫汉鑲夐潰鏉垮鍣紙璺嚎 B锛?#   EMBED=1        鍐呭祵缃戝叧锛氭妸 agent2api_ios.a 闈欐€侀摼鎺ヨ繘 App锛堣矾绾?A2锛?#
# 鐢ㄦ硶锛?#   ./scripts/build-ipa.sh                     # 绾鎴风
#   EMBED=1 ./scripts/build-ipa.sh             # 鍐呭祵缃戝叧锛堥渶瑕佸厛缂?Rust锛?#   UI_SRC=../_a2a/ui ./scripts/build-ipa.sh   # 鎸囧畾闈㈡澘闈欐€佽祫婧愶紙EMBED=1 鏃舵墦杩?bundle锛?#   SRC=~/src/Agent2API EMBED=1 ./scripts/build-ipa.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${SRC:-$ROOT/../Agent2API}"                       # 涓婃父 clone 浣嶇疆
UI_SRC="${UI_SRC:-$ROOT/../_a2a/ui}"                   # 浠?KSU 妯″潡 zip 閲岃В鍑烘潵鐨?ui/
EMBED="${EMBED:-0}"
APP_NAME="Agent2API"
BUNDLE_ID="com.chiyu.agent2api"
MIN_IOS="15.0"
BUILD="$ROOT/build"
APP="$BUILD/Payload/$APP_NAME.app"
RUST_TARGET="aarch64-apple-ios"

echo "==> [1/7] 鐜妫€鏌?
command -v xcrun >/dev/null || { echo "缂哄皯 Xcode Command Line Tools"; exit 1; }
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
echo "    SDK: $SDK"

echo "==> [2/7] 娓呯悊 ${BUILD}"
rm -rf "$BUILD"
mkdir -p "$APP" "$BUILD/Payload"

RUST_LIB=""
if [ "$EMBED" = "1" ]; then
  RUST_LIB="$ROOT/ios-ffi/target/${RUST_TARGET}/release/libagent2api_ios.a"
  if [ -f "$RUST_LIB" ]; then
    # CI 閲屼笂涓€姝ュ凡缁忕紪濂戒簡锛氱洿鎺ョ敤锛屽埆鍐嶈姳 2~5 鍒嗛挓閲嶇紪涓€閬?    echo "==> [3a/7] 澶嶇敤宸叉湁 Rust 闈欐€佸簱"
  else
    echo "==> [3a/7] 缂栬瘧 Rust 闈欐€佸簱锛?{RUST_TARGET}锛?
    [ -d "$SRC/desktop-tauri/src-tauri/server" ] || { echo "鎵句笉鍒颁笂娓告簮鐮侊細$SRC"; exit 1; }
    ( cd "$ROOT/ios-ffi" && cargo build --release --target "$RUST_TARGET" )
  fi
  [ -f "$RUST_LIB" ] || { echo "闈欐€佸簱娌′骇鍑猴細$RUST_LIB"; exit 1; }
  echo "    $RUST_LIB ($(du -h "$RUST_LIB" | cut -f1))"
else
  echo "==> [3b/7] 绾鎴风褰㈡€侊細璺宠繃 Rust"
fi

echo "==> [4/7] 缂栬瘧 Swift锛坅rm64 / iOS ${MIN_IOS}锛?
SWIFT_FLAGS=(
  -sdk "$SDK"
  -target "arm64-apple-ios$MIN_IOS"
  -parse-as-library
  -O
  -whole-module-optimization
  -framework UIKit
  -framework WebKit
  -framework Foundation
  # Rust 渚?#[link(kind="framework")] 涓嶄細闅?staticlib 浼犻€掗摼鎺ュ弬鏁帮紝蹇呴』鏄惧紡琛ワ細
  #   Security       鈥?getrandom 鐨?Apple 鍚庣鐢?SecRandomCopyBytes
  #   CoreFoundation 鈥?iana-time-zone 璇绘湰鍦版椂鍖?  #   CFNetwork      鈥?reqwest 璧?URLSession 鏃剁敤鍒扮殑绯荤粺缃戠粶鏍?  -framework Security
  -framework CoreFoundation
  -framework CFNetwork
  -Xlinker -rpath -Xlinker /usr/lib/swift
)
if [ "$EMBED" = "1" ]; then
  SWIFT_FLAGS+=(
    -D A2A_EMBEDDED
    -import-objc-header "$ROOT/app/Agent2API/Agent2API-Bridging-Header.h"
    -L "$(dirname "$RUST_LIB")" -lagent2api_ios
  )
fi

xcrun -sdk iphoneos swiftc "${SWIFT_FLAGS[@]}" \
  "$ROOT/app/Agent2API/AppDelegate.swift" \
  "$ROOT/app/Agent2API/PanelViewController.swift" \
  "$ROOT/app/Agent2API/PanelSessionStore.swift" \
  "$ROOT/app/Agent2API/LoginContainer.swift" \
  "$ROOT/app/Agent2API/Bridge.swift" \
  -o "$APP/$APP_NAME"

echo "==> [5/7] 缁勮 App 鍖?
cp "$ROOT/app/Agent2API/Info.plist" "$APP/Info.plist"

# 鈹€鈹€ 鏋勫缓鎴筹細鐗堟湰鍙烽殢姣忔鏋勫缓閫掑锛岀洿鎺ュ啓杩?Info.plist锛圓pp 閲岃兘鐪嬪埌锛?#    BUILD_NUMBER 鐢?CI 浼狅紙github.run_number锛夛紱鏈湴鏋勫缓鏃剁敤鏃堕棿鎴冲厹搴曘€?STAMP="${BUILD_NUMBER:-$(date +%y%m%d%H%M)}"
GIT_SHA="${GIT_SHA:-local}"
BUILD_TIME="$(date -u '+%Y-%m-%d %H:%M:%SZ')"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $STAMP" "$APP/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $STAMP" "$APP/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 3.4.$STAMP" "$APP/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 3.4.$STAMP" "$APP/Info.plist"
for kv in "A2ABuildNumber:$STAMP" "A2AGitSha:$GIT_SHA" "A2ABuildTime:$BUILD_TIME"; do
  key="${kv%%:*}"; val="${kv#*:}"
  /usr/libexec/PlistBuddy -c "Add :$key string $val" "$APP/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :$key $val" "$APP/Info.plist"
done
# 妗岄潰鍥炬爣鍚嶅甫鏋勫缓鍙凤細涓€鐪肩湅鍑鸿鐨勬槸鍝竴鐗堬紙璋冭瘯鏈熼潪甯告湁鐢級
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName A2A $STAMP" "$APP/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string A2A $STAMP" "$APP/Info.plist"
echo "    鏋勫缓鎴筹細3.4.$STAMP  sha=${GIT_SHA}  ${BUILD_TIME}  鍥炬爣鍚?A2A $STAMP"
printf 'APPL????' > "$APP/PkgInfo"
cp "$ROOT/app/Agent2API/Resources/"*.png "$APP/"

if [ "$EMBED" = "1" ]; then
  [ -d "$UI_SRC" ] || { echo "鎵句笉鍒伴潰鏉胯祫婧愶細${UI_SRC}锛圗MBED=1 蹇呭～锛?; exit 1; }
  echo "    鎵撳叆闈㈡澘 ui/锛?(du -sh "$UI_SRC" | cut -f1)锛?
  cp -R "$UI_SRC" "$APP/ui"
  # 闈㈡澘閲岀殑 SW 缂撳瓨鎴虫寜鍐呭绠椾竴娆★紝閬垮厤 WebView 鎷挎棫缂撳瓨
  if [ -f "$APP/ui/sw.js" ]; then
    STAMP="$(cat "$APP/ui/m.html" "$APP/ui/m/mobile.js" 2>/dev/null | md5 -q | cut -c1-12)"
    sed -i '' "s|const CACHE = '[^']*'|const CACHE = 'agent2api-mobile-$STAMP'|" "$APP/ui/sw.js"
  fi
fi

echo "==> [6/7] 绛惧悕"
if command -v ldid >/dev/null; then
  ENT_FILE="${ENTITLEMENTS:-$ROOT/app/Agent2API/entitlements.plist}"
  ldid -S"$ENT_FILE" "$APP/$APP_NAME"
  echo "    ldid 宸叉敞鍏?$(basename "$ENT_FILE")"
elif command -v codesign >/dev/null; then
  # CI / 鏃?ldid 鐜锛歛d-hoc 绛惧悕銆傝秺鐙辨満锛圓MFI 琚ˉ涓佹斁寮€锛夊彲鐩存帴瀹夎杩愯銆?  codesign --force --timestamp=none --sign - "$APP/$APP_NAME"
  echo "    鈿?鏃?ldid锛屽凡鐢?codesign ad-hoc 绛惧悕锛堣秺鐙辨満鍙敤锛涜瘉涔︾幆澧冭璧?xcodebuild锛?
else
  echo "    鈿?鏃㈡棤 ldid 涔熸棤 codesign锛氫骇鐗╂湭绛惧悕锛屽畨瑁呭墠蹇呴』鑷绛惧悕"
fi

echo "==> [7/7] 鎵?IPA"
( cd "$BUILD" && zip -qry "$APP_NAME.ipa" Payload )
ls -lh "$BUILD/$APP_NAME.ipa"
echo
echo "瀹夎锛堣秺鐙辨満锛夛細"
echo "  appinst $BUILD/$APP_NAME.ipa            # AppSync 鐜"
echo "  # 鎴?TrollStore 閲岀洿鎺ョ偣寮€璇?IPA锛涙垨 ios-deploy --bundle ${APP}锛堝紑鍙戣€呰瘉涔︼紝7 澶╋級"
