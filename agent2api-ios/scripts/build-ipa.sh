#!/bin/bash
# ── Agent2API · iOS IPA 构建脚本（macOS 上跑）──────────────────────────
# 两条形态：
#   EMBED=0（默认）纯客户端壳：不链接 Rust，只做人肉面板容器（路线 B）
#   EMBED=1        内嵌网关：把 agent2api_ios.a 静态链接进 App（路线 A2）
#
# 用法：
#   ./scripts/build-ipa.sh                     # 纯客户端
#   EMBED=1 ./scripts/build-ipa.sh             # 内嵌网关（需要先编 Rust）
#   UI_SRC=../_a2a/ui ./scripts/build-ipa.sh   # 指定面板静态资源（EMBED=1 时打进 bundle）
#   SRC=~/src/Agent2API EMBED=1 ./scripts/build-ipa.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${SRC:-$ROOT/../Agent2API}"                       # 上游 clone 位置
UI_SRC="${UI_SRC:-$ROOT/../_a2a/ui}"                   # 从 KSU 模块 zip 里解出来的 ui/
EMBED="${EMBED:-0}"
APP_NAME="Agent2API"
BUNDLE_ID="com.chiyu.agent2api"
MIN_IOS="15.0"
BUILD="$ROOT/build"
APP="$BUILD/Payload/$APP_NAME.app"
RUST_TARGET="aarch64-apple-ios"

echo "==> [1/7] 环境检查"
command -v xcrun >/dev/null || { echo "缺少 Xcode Command Line Tools"; exit 1; }
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
echo "    SDK: $SDK"

echo "==> [2/7] 清理 ${BUILD}"
rm -rf "$BUILD"
mkdir -p "$APP" "$BUILD/Payload"

RUST_LIB=""
if [ "$EMBED" = "1" ]; then
  echo "==> [3a/7] 编译 Rust 静态库（${RUST_TARGET}）"
  [ -d "$SRC/desktop-tauri/src-tauri/server" ] || { echo "找不到上游源码：$SRC"; exit 1; }
  ( cd "$ROOT/ios-ffi" && cargo build --release --target "$RUST_TARGET" )
  RUST_LIB="$ROOT/ios-ffi/target/$RUST_TARGET/release/libagent2api_ios.a"
  [ -f "$RUST_LIB" ] || { echo "静态库没产出：$RUST_LIB"; exit 1; }
  echo "    $RUST_LIB"
else
  echo "==> [3b/7] 纯客户端形态：跳过 Rust"
fi

echo "==> [4/7] 编译 Swift（arm64 / iOS ${MIN_IOS}）"
SWIFT_FLAGS=(
  -sdk "$SDK"
  -target "arm64-apple-ios$MIN_IOS"
  -parse-as-library
  -O
  -whole-module-optimization
  -framework UIKit
  -framework WebKit
  -framework Foundation
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
  "$ROOT/app/Agent2API/LoginContainer.swift" \
  "$ROOT/app/Agent2API/Bridge.swift" \
  -o "$APP/$APP_NAME"

echo "==> [5/7] 组装 App 包"
cp "$ROOT/app/Agent2API/Info.plist" "$APP/Info.plist"
printf 'APPL????' > "$APP/PkgInfo"
cp "$ROOT/app/Agent2API/Resources/"*.png "$APP/"

if [ "$EMBED" = "1" ]; then
  [ -d "$UI_SRC" ] || { echo "找不到面板资源：${UI_SRC}（EMBED=1 必填）"; exit 1; }
  echo "    打入面板 ui/（$(du -sh "$UI_SRC" | cut -f1)）"
  cp -R "$UI_SRC" "$APP/ui"
  # 面板里的 SW 缓存戳按内容算一次，避免 WebView 拿旧缓存
  if [ -f "$APP/ui/sw.js" ]; then
    STAMP="$(cat "$APP/ui/m.html" "$APP/ui/m/mobile.js" 2>/dev/null | md5 -q | cut -c1-12)"
    sed -i '' "s|const CACHE = '[^']*'|const CACHE = 'agent2api-mobile-$STAMP'|" "$APP/ui/sw.js"
  fi
fi

echo "==> [6/7] 签名"
if command -v ldid >/dev/null; then
  ldid -S"$ROOT/app/Agent2API/entitlements.plist" "$APP/$APP_NAME"
  echo "    ldid 已注入 entitlements（越狱机直接可用）"
elif command -v codesign >/dev/null; then
  # CI / 无 ldid 环境：ad-hoc 签名。越狱机（AMFI 被补丁放开）可直接安装运行。
  codesign --force --timestamp=none --sign - "$APP/$APP_NAME"
  echo "    ⚠ 无 ldid，已用 codesign ad-hoc 签名（越狱机可用；证书环境请走 xcodebuild）"
else
  echo "    ⚠ 既无 ldid 也无 codesign：产物未签名，安装前必须自行签名"
fi

echo "==> [7/7] 打 IPA"
( cd "$BUILD" && zip -qry "$APP_NAME.ipa" Payload )
ls -lh "$BUILD/$APP_NAME.ipa"
echo
echo "安装（越狱机）："
echo "  appinst $BUILD/$APP_NAME.ipa            # AppSync 环境"
echo "  # 或 TrollStore 里直接点开该 IPA；或 ios-deploy --bundle ${APP}（开发者证书，7 天）"
