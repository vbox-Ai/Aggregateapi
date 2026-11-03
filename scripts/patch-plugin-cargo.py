#!/usr/bin/env python3
"""把插件仓库 Cargo.toml 里 reqwest 的 system-proxy 特性按 target 关掉。

原因（与网关那处同一个坑）：`system-proxy` 会拉 `system-configuration`，
后者在 iOS SDK 上编不过（用到了 macOS 专属 API）。插件只需要直连/显式代理，
不需要"跟随系统代理"，所以 iOS 目标一律去掉该特性。

用法：python3 scripts/patch-plugin-cargo.py <仓库根目录或 Cargo.toml 路径>
幂等：已改过则原样返回 0。
"""
import pathlib
import sys

TARGET = 'cfg(not(target_os = "ios"))'


def main() -> int:
    raw = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    path = raw if raw.name == "Cargo.toml" else raw / "Cargo.toml"
    if not path.is_file():
        print(f"[patch] 跳过：找不到 {path}")
        return 0

    text = path.read_text(encoding="utf-8")
    if TARGET in text:
        print("[patch] 已打过补丁，跳过")
        return 0

    # 形如：reqwest = { version = "0.12", ..., features = [..., "system-proxy"] }
    import re

    pattern = re.compile(r'^(reqwest\s*=\s*\{[^}]*?"system-proxy"[^}]*\})\s*$', re.M)
    match = pattern.search(text)
    if not match:
        print("[patch] 未找到带 system-proxy 的 reqwest 行（上游可能已改），保持原样")
        return 0

    original = match.group(1)
    stripped = original.replace(', "system-proxy"', "").replace('"system-proxy", ', "")
    replacement = (
        f'{stripped}\n'
        f'\n'
        f'[target.\'{TARGET}\'.dependencies]\n'
        f'{original}\n'
    )
    text = text[: match.start(1)] + replacement + text[match.end(1):]
    path.write_text(text, encoding="utf-8")
    print(f"[patch] 已改写 {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
