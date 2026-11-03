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
import urllib.request

API = "https://api.github.com"


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
    request = urllib.request.Request(url, headers={"User-Agent": "aggregateapi-ci"})
    with urllib.request.urlopen(request, timeout=600) as response:
        dest.write_bytes(response.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="Agent2Builder/agent2api-providers-releases")
    parser.add_argument("--prefix", required=True, help="资产名前缀，如 agent2api-providers")
    parser.add_argument("--suffix", default="aarch64-unknown-linux-gnu.zip")
    parser.add_argument("--out", default=".cache/official")
    parser.add_argument("--pages", type=int, default=5)
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
    print(f"[fetch] tag={release.get('tag_name')} {asset['name']} ({asset['size']} B)")
    download(asset["browser_download_url"], dest)
    print(f"[fetch] → {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
