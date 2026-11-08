#!/usr/bin/env python3
"""从上游发布仓库下载官方插件包（用作"打包骨架"）。

我们自己编译的是**可执行文件**，但包格式（pack.json 的字段、ui 资源、
providers 清单）以官方包为准 —— 直接拿官方 zip 当骨架，把里面的 Linux
二进制替换成我们的 iOS Mach-O，最稳（不用手写 pack.json，避免 schema 猜错）。

注意：两个包的 release **tag 不同**（主包 `v3.4.0`、网页包 `web-v3.4.0`），
所以不能只看 `releases/latest` —— 这里扫全部分页，按"名称前缀 + 后缀"匹配。

用法：
  python3 scripts/fetch-official-packs.py --prefix agent2api-providers --out .cache/official
  python3 scripts/fetch-official-packs.py --prefix agent2api-web-providers --out .cache/official
环境变量 GITHUB_TOKEN 可提高 API 限额。
"""
import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

API = "https://api.github.com"

# GitHub 的发布资产走 CDN，实测会出现**持续** 504（不是一次抖动：连试 4 次都 504）。
# 除了退避重试，还按顺序尝试用户提供的加速前缀 —— CI 里克隆源码已经在用同样两个源。
# 顺序：直连 → ghfast.top → gh-proxy.com。
MIRROR_PREFIXES = ("", "https://ghfast.top/", "https://gh-proxy.com/")
RETRIES_PER_SOURCE = 2
BACKOFF_SECONDS = (2, 8)


def headers() -> dict:
    base = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "aggregateapi-ci",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        base["Authorization"] = f"Bearer {token}"
    return base


def get_json(url: str):
    request = urllib.request.Request(url, headers=headers())
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, dest: pathlib.Path) -> None:
    """按「直连 → 加速源」逐个试，每个源退避重试；全失败才抛。"""
    last_error: Exception | None = None
    for prefix in MIRROR_PREFIXES:
        target = f"{prefix}{url}"
        label = prefix or "直连"
        for attempt in range(RETRIES_PER_SOURCE):
            if attempt:
                delay = BACKOFF_SECONDS[min(attempt - 1, len(BACKOFF_SECONDS) - 1)]
                print(f"[fetch] {label} 第 {attempt} 次重试，{delay}s 后继续…", flush=True)
                time.sleep(delay)
            request = urllib.request.Request(target, headers={"User-Agent": "aggregateapi-ci"})
            try:
                with urllib.request.urlopen(request, timeout=600) as response:
                    payload = response.read()
                # 先写临时文件再改名：中途失败不会留下半个 zip 被后面当成好文件用
                temp = dest.with_suffix(dest.suffix + ".part")
                temp.write_bytes(payload)
                temp.replace(dest)
                print(f"[fetch] 下载成功（{label}）", flush=True)
                return
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as error:
                last_error = error
                print(f"[fetch] {label} 下载失败：{error}", flush=True)
    raise RuntimeError(f"下载 {url} 所有源都失败：{last_error}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="Agent2Builder/agent2api-providers-releases")
    parser.add_argument("--prefix", required=True, help="资产名前缀，如 agent2api-providers")
    parser.add_argument("--suffix", default="aarch64-unknown-linux-gnu.zip")
    parser.add_argument("--out", default=".cache/official")
    parser.add_argument("--pages", type=int, default=5)
    parser.add_argument(
        "--optional",
        action="store_true",
        help="取不到就只警告并返回 0（骨架包是「省得手写 pack.json」的优化，不是必需品；"
             "调用方据此跳过打包，而不是让整个作业失败）",
    )
    parser.add_argument("--force", action="store_true", help="忽略已有文件，强制重新下载")
    args = parser.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    found = None
    for page in range(1, args.pages + 1):
        releases = get_json(f"{API}/repos/{args.repo}/releases?per_page=30&page={page}")
        if not releases:
            break
        for release in releases:
            for asset in release.get("assets", []):
                name = asset["name"]
                if name.startswith(args.prefix) and name.endswith(args.suffix):
                    found = (release, asset)
                    break
            if found:
                break
        if found:
            break

    if not found:
        print(f"[fetch] {args.repo} 的前 {args.pages} 页 release 里没有 "
              f"{args.prefix}*{args.suffix}，请检查发布的资产名")
        return 1

    release, asset = found
    dest = out / asset["name"]
    # 已经有了就直接用：CI 会把 .cache/official 缓存起来，上游 CDN 抽风时
    # （实测会持续 504）这一层缓存就是唯一能拿到骨架包的途径。
    if dest.exists() and dest.stat().st_size > 0 and not args.force:
        print(f"[fetch] 已有 {dest}（{dest.stat().st_size} B），跳过下载")
        return 0
    print(f"[fetch] tag={release.get('tag_name')} {asset['name']} ({asset['size']} B)")
    try:
        download(asset["browser_download_url"], dest)
    except RuntimeError as error:
        if args.optional:
            print(f"[fetch] WARN: {error}")
            print("[fetch] WARN: 本次跳过官方骨架包（调用方应据此跳过打包步骤）")
            return 0
        raise
    print(f"[fetch] → {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
