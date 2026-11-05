#!/usr/bin/env python3
"""从 `git ls-remote --tags` 的输出里取最大的 vX.Y.Z。

为什么不用 `sort -V`：macOS 自带的是 BSD sort，没有 -V（GNU 才有），
CI 跑在 macos-14 上会直接 "illegal option"。

用法：
  git ls-remote --tags --refs origin 'v*' | python3 scripts/latest-tag.py
"""
import re
import sys

PATTERN = re.compile(r"^v?(\d+)\.(\d+)(?:\.(\d+))?")


def key(version: str):
    match = PATTERN.match(version)
    if not match:
        return None
    return tuple(int(part or 0) for part in match.groups())


def main() -> int:
    best = None
    best_key = None
    for line in sys.stdin:
        text = line.strip().rsplit("/", 1)[-1]
        parsed = key(text)
        if parsed is None:
            continue
        if best_key is None or parsed > best_key:
            best, best_key = text, parsed
    if best:
        print(best)
    return 0


if __name__ == "__main__":
    sys.exit(main())
