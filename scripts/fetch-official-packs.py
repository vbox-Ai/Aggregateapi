#!/usr/bin/env python3
"""从上游发布仓库下载官方插件包（用作"打包骨架"）。

我们自己编译的是**可执行文件**，但包格式（pack.json 的字段、ui 资源、
providers 清单）以官方包为准 —— 直接拿官方 zip 当骨架，把里面的 Linux
二进制替换成我们的 iOS Mach-O，最稳（不用手写 pack.json，避免 schema 猜错）。

用法：
  python3 scripts/fetch-official-packs.py --repo Agent2Builder/agent2api-providers-releases \
      --suffix aarch64-unknown-linux-gnu.zip --out .cache/official --prefix agent2api-providers
可选环境变量 GITHUB_TOKEN（提高 API 限额）。
"""
import argparse
import json
import os
import pathlib
import sys
import urllib.request

API = "https://api.github.com"


def get_json(url: str):
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "aggregateapi-ci",
        **({"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"} if os.environ.get("GITHUB_TOKEN") else {}),
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, dest: pathlib.Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "aggregateapi-ci"})
    with urllib.request.urlopen(request, timeout=300) as response:
        dest.write_bytes(response.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="Agent2Builder/agent2api-providers-releases")
    parser.add_argument("--suffix", default="aarch64-unknown-linux-gnu.zip")
    parser.add_argument("--prefix", default="agent2api-providers")
    parser.add_argument("--out", default=".cache/official")
    args = parser.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    release = get_json(f"{API}/repos/{args.repo}/releases")
    if not isinstance(release, list) or not release:
        print(f"[fetch] {args.repo} 没有 release")
        return 1

    wanted = [a for a in release[0].get("assets", []) if a["name"].endswith(args.suffix)]
    if not wanted:
        print(f"[fetch] 最新 release 里没有 *{args.suffix} 资产："
              f"{[a['name'] for a in release[0].get('assets', [])]}")
        return 1

    for asset in wanted:
        if not asset["name"].startswith(args.prefix):
            continue
        dest = out / asset["name"]
        print(f"[fetch] {asset['name']} ({asset['size']} B)")
        download(asset["browser_download_url"], dest)
        print(f"[fetch] → {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
