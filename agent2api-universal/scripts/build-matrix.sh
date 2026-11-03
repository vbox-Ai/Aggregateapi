#!/usr/bin/env bash
# ── Agent2API · 六端产物矩阵 ────────────────────────────────────────────────
# 一条命令产出：Windows msi / macOS dmg / Linux AppImage+deb+docker /
#              Android(KSU zip + APK) / iOS(daemon + ipa) / Web(静态)
#
# 用法：
#   ./scripts/build-matrix.sh                 # 只在当前平台编"能编的那几端"
#   TARGETS="ios android-ksu" ./scripts/build-matrix.sh
#   SKIP_SHELL=1 ./scripts/build-matrix.sh    # 只编后端，不打壳（CI 分层用）
#
# 前提（按需）：
#   rustup target add aarch64-apple-ios aarch64-linux-android x86_64-pc-windows-msvc
#   cargo install tauri-cli --version "^2"
#   Android: NDK r29 + SDK；iOS/macOS: Xcode 15+
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${SRC:-$ROOT/../Agent2API}"                    # 上游 clone
IOS_DIR="${IOS_DIR:-$ROOT/../agent2api-ios}"        # iOS 兜底壳工程（已交付）
OUT="${OUT:-$ROOT/out}"
TARGETS="${TARGETS:-auto}"
SKIP_SHELL="${SKIP_SHELL:-0}"
TAURI_DIR="$SRC/desktop-tauri/src-tauri"
VERSION="$(grep -m1 '^version' "$TAURI_DIR/Cargo.toml" | cut -d'"' -f2 || echo 0.0.0)"

mkdir -p "$OUT"
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

[ -d "$SRC" ] || { echo "找不到上游源码：${SRC}（设 SRC=...）"; exit 1; }

# ── 目标选择 ───────────────────────────────────────────────────────────────
if [ "$TARGETS" = "auto" ]; then
  case "$(uname -s)" in
    Darwin) TARGETS="macos ios" ;;
    Linux)  TARGETS="linux android-ksu" ;;
    MINGW*|MSYS*|CYGWIN*) TARGETS="windows" ;;
    *) TARGETS="linux" ;;
  esac
fi

# ── 1. Windows ─────────────────────────────────────────────────────────────
build_windows() {
  log "Windows · msi/exe（Tauri 2）"
  ( cd "$TAURI_DIR" && cargo tauri build --target x86_64-pc-windows-msvc )
  mkdir -p "$OUT/windows"
  cp -R "$TAURI_DIR/target/x86_64-pc-windows-msvc/release/bundle/"* "$OUT/windows/" 2>/dev/null || true
  ls -lh "$OUT/windows"
}

# ── 2. macOS ───────────────────────────────────────────────────────────────
build_macos() {
  log "macOS · universal dmg（arm64 + x86_64）"
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null 2>&1 || true
  ( cd "$TAURI_DIR" && cargo tauri build --target universal-apple-darwin )
  mkdir -p "$OUT/macos"
  cp -R "$TAURI_DIR/target/universal-apple-darwin/release/bundle/"* "$OUT/macos/" 2>/dev/null || true
  # 常驻用的 LaunchAgent + 独立二进制（无 GUI 场景）
  ( cd "$TAURI_DIR" && cargo build -p agent2api-server --release --target aarch64-apple-darwin )
  cp "$TAURI_DIR/target/aarch64-apple-darwin/release/agent2api-server" "$OUT/macos/"
  ls -lh "$OUT/macos"
}

# ── 3. Linux ───────────────────────────────────────────────────────────────
build_linux() {
  log "Linux · AppImage/deb + 独立二进制"
  ( cd "$TAURI_DIR" && cargo tauri build --target x86_64-unknown-linux-gnu )
  mkdir -p "$OUT/linux"
  cp -R "$TAURI_DIR/target/release/bundle/"* "$OUT/linux/" 2>/dev/null || true
  ( cd "$TAURI_DIR" && cargo build -p agent2api-server --release )
  cp "$TAURI_DIR/target/release/agent2api-server" "$OUT/linux/"
  ls -lh "$OUT/linux"
}

# ── 4. Docker（Web 端后端）──────────────────────────────────────────────────
build_docker() {
  log "Docker · 供 Web/PWA 与远程部署"
  if ! have docker; then echo "  跳过（无 docker）"; return 0; fi
  ( cd "$SRC" && docker build -t "agent2api:$VERSION" -f Dockerfile . )
  echo "  镜像：agent2api:$VERSION"
}

# ── 5. Android · KSU 模块（root 超集形态：可 exec 插件）────────────────────
build_android_ksu() {
  log "Android · KSU 模块 zip（aarch64-linux-android）"
  local ndk="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
  [ -n "$ndk" ] || { echo "  跳过（未设 ANDROID_NDK_HOME）"; return 0; }
  rustup target add aarch64-linux-android >/dev/null 2>&1 || true

  local linker="$ndk/toolchains/llvm/prebuilt/$(uname -s | tr '[:upper:]' '[:lower:]')-x86_64/bin/aarch64-linux-android24-clang"
  [ -x "$linker" ] || linker="$(ls "$ndk"/toolchains/llvm/prebuilt/*/bin/aarch64-linux-android24-clang | head -1)"

  ( cd "$TAURI_DIR" && \
    CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$linker" \
    cargo build -p agent2api-server --release --target aarch64-linux-android )

  mkdir -p "$OUT/android"
  cp "$TAURI_DIR/target/aarch64-linux-android/release/agent2api-server" "$OUT/android/agent2api-server"

  # 直接复用现有模块 zip 的骨架（脚本 + ui + glibc + 插件），只换二进制
  if [ -f "$ROOT/assets/agent2api-ksu-module.zip" ]; then
    log "  重打模块 zip（替换 bin/agent2api-server）"
    local stage="$OUT/android/stage"; rm -rf "$stage"; mkdir -p "$stage"
    ( cd "$stage" && unzip -q "$ROOT/assets/agent2api-ksu-module.zip" )
    cp "$OUT/android/agent2api-server" "$stage/bin/agent2api-server"
    ( cd "$stage" && zip -qry "$OUT/android/agent2api-ksu-module.zip" . )
    rm -rf "$stage"
  else
    echo "  ⚠ 没找到模块骨架 assets/agent2api-ksu-module.zip，只产出了二进制"
  fi
  ls -lh "$OUT/android"
}

# ── 6. Android · 普通 APK（无 root 降级入口：无插件、前台 Service）────────
build_android_apk() {
  log "Android · APK（Tauri 2 android 目标）"
  [ "$SKIP_SHELL" = "1" ] && { echo "  SKIP_SHELL=1，跳过"; return 0; }
  if ! have cargo-tauri; then echo "  跳过（未装 tauri-cli）"; return 0; fi
  ( cd "$TAURI_DIR" && cargo tauri android build --apk )
  mkdir -p "$OUT/android-apk"
  find "$TAURI_DIR/gen/android" -name '*.apk' -exec cp {} "$OUT/android-apk/" \; 2>/dev/null || true
  ls -lh "$OUT/android-apk" 2>/dev/null || echo "  ⚠ 未找到 apk 产物"
}

# ── 7. iOS · daemon + ipa ──────────────────────────────────────────────────
build_ios() {
  log "iOS · daemon(Mach-O) + ipa（${IOS_DIR}）"
  [ "$(uname -s)" = "Darwin" ] || { echo "  跳过（iOS 只能在 macOS 上编）"; return 0; }
  rustup target add aarch64-apple-ios >/dev/null 2>&1 || true

  log "  · 守护进程"
  ( cd "$TAURI_DIR" && IPHONEOS_DEPLOYMENT_TARGET=15.0 \
      cargo build -p agent2api-server --release --target aarch64-apple-ios )
  mkdir -p "$OUT/ios"
  cp "$TAURI_DIR/target/aarch64-apple-ios/release/agent2api-server" "$OUT/ios/"

  if [ -d "$IOS_DIR" ] && [ "$SKIP_SHELL" != "1" ]; then
    log "  · IPA（兜底壳）"
    ( cd "$IOS_DIR" && EMBED="${EMBED:-0}" ./scripts/build-ipa.sh )
    cp "$IOS_DIR/build/Agent2API.ipa" "$OUT/ios/" 2>/dev/null || true
  fi
  ls -lh "$OUT/ios"
}

# ── 8. Web · 静态面板（PWA，随后端托管或独立反代）──────────────────────────
build_web() {
  log "Web · 面板静态资源 + PWA 清单"
  mkdir -p "$OUT/web"
  local ui="$TAURI_DIR/ui"
  [ -d "$ui" ] || ui="$TAURI_DIR/../ui"
  if [ -d "$ui" ]; then
    cp -R "$ui/." "$OUT/web/"
    # 注入宿主能力层（六端同一份面板）
    if [ -f "$ROOT/ui/host.js" ]; then
      cp "$ROOT/ui/host.js" "$OUT/web/host.js"
      for f in "$OUT/web/index.html" "$OUT/web/m.html"; do
        [ -f "$f" ] && grep -q 'host.js' "$f" || sed -i.bak 's|</head>|  <script src="host.js"></script>\n</head>|' "$f" 2>/dev/null || true
      done
    fi
    echo "  已产出 $OUT/web（把网关的 AGENT2API_UI_DIR 指到它即可）"
  else
    echo "  ⚠ 找不到面板目录"
  fi
}

# ── 执行 ───────────────────────────────────────────────────────────────────
for t in $TARGETS; do
  case "$t" in
    windows)      build_windows ;;
    macos)        build_macos ;;
    linux)        build_linux ;;
    docker)       build_docker ;;
    android-ksu)  build_android_ksu ;;
    android-apk)  build_android_apk ;;
    ios)          build_ios ;;
    web)          build_web ;;
    *) echo "未知目标：$t" ;;
  esac
done

# Web 静态资源与 docker 总是顺手产出（成本极低，且 Web 端是"零壳"形态）
case " $TARGETS " in *" web "*) ;; *) build_web ;; esac

log "产物清单（${OUT}）"
( cd "$OUT" && find . -maxdepth 2 -type f \( -name '*.msi' -o -name '*.exe' -o -name '*.dmg' -o -name '*.AppImage' -o -name '*.deb' \
   -o -name '*.zip' -o -name '*.apk' -o -name '*.ipa' -o -name 'agent2api-server' \) -exec ls -lh {} \; )
echo
echo "版本：$VERSION   目标：$TARGETS"
echo "下一步：把各端产物连同 artifacts 一起上传（CI 见 .github/workflows/matrix.yml）"
