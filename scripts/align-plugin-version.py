#!/usr/bin/env python3
"""让插件包版本不低于网关版本。

上游 3.5.0-beta.2 之后，`compatibility.rs` 开头写明「兼容性只由公共接口决定，
不比较插件与主程序的产品版本号」，只校验 protocol 与 capabilities。
但更早的版本（以及部分分支）确有 `pack.version >= CURRENT_VERSION` 的硬要求，
低于就整包不加载、连安装都被拒。这个脚本保留下来当保险：宁可把版本号抬齐，
也不要出现「装上了却一家都没起来」。

用法（CI 里在编插件包之前跑一次）：
  python3 scripts/align-plugin-version.py --min-version 3.4.2
"""
import argparse
import json
import pathlib
import sys


def parse(version: str):
    """把版本号拆成可直接比较的 key，遵循 semver 的优先级规则。

    返回 ``(major, minor, patch, release_flag, pre_key)``：

    * ``release_flag``：正式版为 1、预发布为 0（正式版 > 任何预发布）；
    * ``pre_key``：预发布标识符序列；数字标识按**数值**比、字母标识按字典序比，
      短前缀不算大（``beta`` < ``beta.1`` < ``beta.2`` < ``beta.10``）。

    旧实现把 ``-beta.1`` 整段丢掉，导致 ``3.5.0-beta.1`` 与 ``3.5.0-beta.7``
    被判为相等，插件包版本会永远停在第一次出现的那个 beta 上。
    """
    without_build = version.partition("+")[0]
    core, _, pre = without_build.partition("-")
    parts = core.split(".")
    if len(parts) < 2:
        return None
    try:
        nums = tuple(int(part) for part in (parts + ["0", "0"])[:3])
    except ValueError:
        return None
    if not pre:
        return nums + (1, ())
    identifiers = []
    for ident in pre.split("."):
        if ident.isdigit():
            identifiers.append((0, int(ident), ""))
        else:
            identifiers.append((1, 0, ident))
    return nums + (0, tuple(identifiers))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-version", required=True, help="网关版本，如 3.4.2")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()

    minimum = args.min_version.strip().lstrip("vV")
    floor = parse(minimum)
    if floor is None:
        print(f"[align] 无法解析网关版本：{args.min_version}")
        return 1

    changed = False
    for path in sorted(pathlib.Path(args.root, "plugins").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        current = str(data.get("version", ""))
        parsed = parse(current)
        if parsed is None:
            print(f"[align] {path.name}: 版本号无法解析（{current}），跳过")
            continue
        if parsed < floor:
            data["version"] = minimum
            path.write_bytes(
                (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            )
            print(f"[align] {path.name}: {current} → {minimum}（低于网关要求，已抬到下限）")
            changed = True
        else:
            print(f"[align] {path.name}: {current} >= {minimum}，保持")
    return 0


def _self_check() -> None:
    """防止回归：预发布段的比较必须真的生效。"""
    assert parse("3.5.0-beta.1") < parse("3.5.0-beta.7")
    assert parse("3.5.0-beta.10") > parse("3.5.0-beta.7")
    assert parse("3.5.0") > parse("3.5.0-beta.7")
    assert parse("3.5.0-beta") < parse("3.5.0-beta.1")


if __name__ == "__main__":
    _self_check()
    sys.exit(main())
