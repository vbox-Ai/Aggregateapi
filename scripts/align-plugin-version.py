#!/usr/bin/env python3
"""让插件包版本不低于网关版本。

网关里 `compatibility.rs::minimum_version()` 对这两个配套包硬性要求：

    pack.version >= CURRENT_VERSION          # CURRENT_VERSION = 网关自身编译版本

低于就整包不加载（面板显示「需要补齐插件」「已加载 0 家」），
而且这条校验发生在 `packages::prepare()` 里 —— 连安装都会被拒。
所以只要有一次用更新的上游 tag 编网关、插件清单还停在旧版本，
用户在手机上看到的就是"装上了但一家都没起来"。

用法（CI 里在编插件包之前跑一次）：
  python3 scripts/align-plugin-version.py --min-version 3.4.2
"""
import argparse
import json
import pathlib
import sys


def parse(version: str):
    core = version.split("-", 1)[0].split("+", 1)[0]
    parts = core.split(".")
    if len(parts) < 2:
        return None
    try:
        return tuple(int(part) for part in (parts + ["0", "0"])[:3])
    except ValueError:
        return None


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


if __name__ == "__main__":
    sys.exit(main())
