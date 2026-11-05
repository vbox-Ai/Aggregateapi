#!/usr/bin/env bash
# ── 把 provider crate 编成静态库，供 daemon 内嵌（C 方案）──
#
# 用法：build-pack-host.sh <plugins_src> <out_dir> [features]
# 产物：<out_dir>/libpack_host.a
#
# 为什么包一层 pack_host：staticlib 各自带一份 std，直接把大库链进同一个
# 二进制会出现重复符号；包一层后只有 pack_host 这一份 std。
set -euo pipefail

REPO="${1:?用法: build-pack-host.sh <plugins_src> <out_dir> [features]}"
OUT="${2:?}"
FEATURES="${3:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$REPO/crates/providers"
[ -d "$CRATE" ] || { echo "找不到 providers crate：$CRATE"; exit 1; }
# Cargo 的 path 依赖按"清单所在目录"解析，必须传绝对路径
CRATE="$(cd "$CRATE" && pwd)"

HOST="$OUT/pack_host"
mkdir -p "$OUT"
rm -rf "$HOST"
mkdir -p "$HOST/src"

echo "==> 给 provider crate 生成 lib 目标"
python3 "$ROOT/scripts/make-pack-lib.py" "$CRATE" pack_inner "providers::registry()"

echo "==> 生成 pack_host crate"
python3 "$ROOT/scripts/gen-pack-host.py" "$CRATE" "$HOST" "$FEATURES"

cat > "$HOST/src/lib.rs" <<'EOF'
//! 内嵌宿主：daemon 的 `--serve-pack` 模式直接调用 `serve()`。
//!
//! 用 rlib（不是 staticlib）：staticlib 会各自带一份 std，
//! 链进 daemon 时出现 `duplicate symbol _rust_eh_personality`。

/// 走 SDK 标准的 stdin/stdout JSON 行协议，直到连接断开。
pub fn serve() {
    agent2api_provider_sdk::serve_blocking(pack_inner::registry_all());
}
EOF

echo "==> 编 pack_host 静态库（aarch64-apple-ios）"
( cd "$HOST" && cargo build --release --target aarch64-apple-ios )

LIB="$HOST/target/aarch64-apple-ios/release/libpack_host.rlib"
[ -f "$LIB" ] || { echo "❌ 没编出 $LIB"; exit 1; }
echo "==> 产出：$LIB ($(du -h "$LIB" | cut -f1))"
