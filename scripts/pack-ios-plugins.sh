#!/usr/bin/env bash
# ── 把官方插件包改造成 iOS 包（可执行文件换成我们的 Mach-O）───────────────
#
# 做法：拿官方 zip 当骨架（pack.json schema / ui 资源 / providers 清单都照抄），
#       只做三件事：
#         1) 把入口二进制替换成我们用 aarch64-apple-ios 编出来的程序；
#         2) 把 pack.json 的 entry 改成只剩 `aarch64-apple-ios` 一个键
#            —— 这样网关在 iOS 上（host_target=…-linux-gnu）精确匹配失败，
#            会走 entry_for_target 的"架构+系统"宽松匹配，正好命中 ios；
#         3) 删掉 signature 段（二进制换了，原签名必然失效）。
#
# 用法：
#   ./scripts/pack-ios-plugins.sh \
#       --official .cache/official/agent2api-providers-3.4.0-aarch64-unknown-linux-gnu.zip \
#       --binary   build/ios/agent2api-providers \
#       --id       agent2api-providers \
#       --version  3.4.0 \
#       --out      out/plugins
#
# 产出：{out}/{id}-{version}-aarch64-unknown-linux-gnu.zip
#       （资产名必须用 linux-gnu 后缀：网关在 iOS 上按这个 target 找资产）
set -euo pipefail

OFFICIAL=""
BINARY=""
PACK_ID=""
VERSION=""
OUT="out/plugins"
ASSET_TARGET="aarch64-unknown-linux-gnu"

while [ $# -gt 0 ]; do
  case "$1" in
    --official) OFFICIAL="$2"; shift 2 ;;
    --binary)   BINARY="$2";   shift 2 ;;
    --id)       PACK_ID="$2";  shift 2 ;;
    --version)  VERSION="$2";  shift 2 ;;
    --out)      OUT="$2";      shift 2 ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

for required in OFFICIAL BINARY PACK_ID VERSION; do
  eval "value=\$$required"
  [ -n "$value" ] || { echo "缺少参数：--$(echo "$required" | tr 'A-Z_' 'a-z-')"; exit 2; }
done
[ -f "$OFFICIAL" ] || { echo "找不到官方包：$OFFICIAL"; exit 1; }
[ -f "$BINARY" ]   || { echo "找不到二进制：$BINARY"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
# 后面会 cd 进包目录再 zip，$OUT 必须先转成绝对路径，
# 否则相对路径会在临时目录里被解析 → zip 报 "Could not create output file"
OUT="$(cd "$OUT" && pwd)"
STAGE="$WORK/pkg"
mkdir -p "$STAGE"

echo "==> 解包官方骨架"
unzip -q "$OFFICIAL" -d "$STAGE"

# 有的包会把内容放在一层目录里（zip 根只有 <id>/pack.json）—— 归一化到 true root
if [ ! -f "$STAGE/pack.json" ]; then
  NESTED="$(find "$STAGE" -maxdepth 3 -name pack.json -type f | head -1 || true)"
  if [ -n "${NESTED}" ]; then
    STAGE="$(dirname "$NESTED")"
    echo "    骨架有嵌套目录，实际包根：$STAGE"
  else
    echo "❌ 官方包里找不到 pack.json，无法作为骨架" >&2
    exit 1
  fi
fi

echo "==> 改写 pack.json（entry 只留 aarch64-apple-ios，删签名）"
python3 - "$STAGE/pack.json" "$PACK_ID" "$VERSION" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
pack_id = sys.argv[2]
version = sys.argv[3]
data = json.loads(path.read_text(encoding="utf-8"))

entry = data.get("entry") or {}
names = list(entry.values())
if not names:
    # 有的骨架把入口写成包名本身
    names = [pack_id]
entry_name = names[0]

data["id"] = pack_id
data["version"] = version
# 关键：网关在 iOS 上把 host_target() 判成 aarch64-unknown-linux-gnu，
# 而 packages.rs 里的入口查找是 **严格 get(target)**（不走宽松匹配），
# 所以 entry 的键必须写成这个三元组，值指向我们的 iOS Mach-O。
# 同时保留 aarch64-apple-ios 便于人工阅读与将来平台识别。
data["entry"] = {
    "aarch64-unknown-linux-gnu": entry_name,
    "aarch64-apple-ios": entry_name,
}
data.pop("signature", None)

path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"[pack] entry={data['entry']}  (入口文件名: {entry_name})")
pathlib.Path(path.parent / ".entry-name").write_text(entry_name, encoding="utf-8")
PY

ENTRY_NAME="$(cat "$STAGE/.entry-name")"
rm -f "$STAGE/.entry-name"

echo "==> 替换入口二进制：$ENTRY_NAME"
rm -f "$STAGE/$ENTRY_NAME"
cp "$BINARY" "$STAGE/$ENTRY_NAME"
chmod 755 "$STAGE/$ENTRY_NAME"
file "$STAGE/$ENTRY_NAME" | head -1

# ── 只保留入口二进制 ────────────────────────────────────────────
# 官方骨架里通常并列放着各平台的二进制（例如 ELF 的 `bin/agent2api-providers`
# 和 exe 的 `bin/agent2api-providers.exe`）。我们只换掉了 entry 指向的那个，
# 其余留着既费体积又容易混淆（有人会把它当成 iOS 版），这里清掉。
ENTRY_BASE="$(basename "$ENTRY_NAME")"
ENTRY_DIR="$(dirname "$ENTRY_NAME")"
[ "$ENTRY_DIR" = "." ] && ENTRY_DIR=""

for stale in "$STAGE"/*; do
  [ -f "$stale" ] || continue
  base="$(basename "$stale")"
  case "$base" in
    pack.json|*.json|*.md|*.txt) continue ;;
  esac
  [ "$base" = "$ENTRY_BASE" ] && continue
  echo "    移除多余文件：$base"
  rm -f "$stale"
done

if [ -n "$ENTRY_DIR" ] && [ -d "$STAGE/$ENTRY_DIR" ]; then
  for stale in "$STAGE/$ENTRY_DIR"/*; do
    [ -f "$stale" ] || continue
    base="$(basename "$stale")"
    [ "$base" = "$ENTRY_BASE" ] && continue
    echo "    移除其它平台二进制：${ENTRY_DIR}/${base}"
    rm -f "$stale"
  done
fi

ASSET="$OUT/${PACK_ID}-${VERSION}-${ASSET_TARGET}.zip"
rm -f "$ASSET"
( cd "$STAGE" && zip -qry "$ASSET" . )

echo "==> 产出：$ASSET ($(du -h "$ASSET" | cut -f1))"
python3 - "$ASSET" <<'PY'
import pathlib
import sys
import zipfile

path = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(path) as archive:
    names = archive.namelist()
print(f"    内含 {len(names)} 项，示例：{names[:6]}")
PY
