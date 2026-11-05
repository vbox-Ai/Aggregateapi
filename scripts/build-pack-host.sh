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

HOST="$OUT/pack_host"
mkdir -p "$OUT"
rm -rf "$HOST"
mkdir -p "$HOST/src"

echo "==> 给 provider crate 生成 lib 目标"
python3 "$ROOT/scripts/make-pack-lib.py" "$CRATE" pack_inner "providers::registry()"

echo "==> 生成 pack_host crate"
python3 - "$CRATE" "$HOST" "$FEATURES" <<'PY'
import pathlib
import re
import sys

crate = pathlib.Path(sys.argv[1])
host = pathlib.Path(sys.argv[2])
features = [x.strip() for x in sys.argv[3].split(",") if x.strip()]

name = "agent2api-providers"
manifest = crate / "Cargo.toml"
m = re.search(r'(?m)^name\s*=\s*"([^"]+)"', manifest.read_text(encoding="utf-8"))
if m:
    name = m.group(1)

if features:
    dep = '%s = { path = "%s", default-features = false, features = [%s] }' % (
        name, crate.as_posix(), ", ".join('"%s"' % f for f in features))
else:
    dep = '%s = { path = "%s" }' % (name, crate.as_posix())

(host / "Cargo.toml").write_text(f"""[package]
name = "pack_host"
version = "0.1.0"
edition = "2021"

[lib]
name = "pack_host"
crate-type = ["staticlib"]

[dependencies]
{dep}
""", encoding="utf-8")
print("   依赖：", dep)
PY

cat > "$HOST/src/lib.rs" <<'EOF'
//! 内嵌宿主：把 provider 注册表暴露成一个 C ABI 函数，供 daemon 的
//! `--serve-pack` 模式调用（协议仍是 SDK 标准的 stdin/stdout JSON 行）。

#[no_mangle]
pub extern "C" fn pack_host_serve() {
    agent2api_provider_sdk::serve_blocking(pack_inner::registry_all());
}
EOF

echo "==> 编 pack_host 静态库（aarch64-apple-ios）"
( cd "$HOST" && cargo build --release --target aarch64-apple-ios )

LIB="$HOST/target/aarch64-apple-ios/release/libpack_host.a"
[ -f "$LIB" ] || { echo "❌ 没编出 $LIB"; exit 1; }
cp "$LIB" "$OUT/libpack_host.a"
echo "==> 产出：$OUT/libpack_host.a ($(du -h "$OUT/libpack_host.a" | cut -f1))"
