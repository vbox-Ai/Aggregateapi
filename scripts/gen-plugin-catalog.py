#!/usr/bin/env python3
"""生成自建插件目录（catalog.json），供手机端「插件 → 检查更新 / 安装」直接读取。

用法：
    python3 scripts/gen-plugin-catalog.py \
        --packs out/packs \
        --base-url https://github.com/vbox-Ai/Aggregateapi/releases/download/ios-20261123-b12 \
        --repo vbox-Ai/Aggregateapi \
        --protocol 9 \
        --out catalog.json

约定：
  · 输入是打包好的 zip，文件名必须是 `<id>-<version>-<target>.zip`（`pack-ios-plugins.sh` 的产物就是）。
  · `target` 对 iOS 写 `aarch64-unknown-linux-gnu`（网关在 iOS 上把 host_target() 回落成这个值）。
  · 每个 id 只会保留**版本号最大**的那一条；不同 target 会合并进同一个 release 的 assets。
  · 目录形状对齐网关的解析器（`core/plugin_host/catalog.rs` + `update::pick_release_assets`）：
    entry.detail.release.{repo,tag,asset} 决定 tag/资产模板，entry.release.assets[] 是 GitHub 发行版形状。
"""
import argparse, hashlib, json, os, re, sys

NAME_RE = re.compile(
    r"^(?P<id>[a-z0-9][a-z0-9-]*?)-(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+?)?)"
    r"-(?P<target>[a-z0-9_]+(?:-[a-z0-9_]+){2,3})\.zip$"
)


def version_key(text):
    """把 3.5.0-beta.7 拆成可比较的元组（release 段数字优先，预发布低于正式）。"""
    main, _, pre = text.partition("-")
    nums = []
    for part in main.split("."):
        nums.append(int(part) if part.isdigit() else 0)
    while len(nums) < 3:
        nums.append(0)
    pre_rank = 1 if not pre else 0
    pre_nums = tuple(re.split(r"[.-]", pre)) if pre else ()
    return (tuple(nums), pre_rank, pre_nums)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--packs", required=True, help="包含 <id>-<version>-<target>.zip 的目录")
    ap.add_argument("--base-url", required=True, help="资产所在的 URL 前缀（GitHub Release 下载地址或自建 CDN）")
    ap.add_argument("--repo", default="", help="可选：仓库标识（仅用于界面展示）")
    ap.add_argument("--protocol", type=int, default=0, help="插件协议号，必须等于网关的 PROTOCOL_VERSION")
    ap.add_argument("--out", default="catalog.json")
    ap.add_argument("--order", type=int, default=10)
    args = ap.parse_args()

    groups = {}
    for name in sorted(os.listdir(args.packs)):
        if not name.endswith(".zip"):
            continue
        m = NAME_RE.match(name)
        if not m:
            print("跳过（文件名不符合 <id>-<version>-<target>.zip）：%s" % name, file=sys.stderr)
            continue
        key = (m.group("id"), m.group("version"))
        groups.setdefault(key, []).append((m.group("target"), os.path.join(args.packs, name)))

    if not groups:
        print("没有可用的插件包", file=sys.stderr)
        return 1

    # 每个 id 只留版本最大的那条
    best = {}
    for (pid, version), items in groups.items():
        if pid not in best or version_key(version) > version_key(best[pid][0]):
            best[pid] = (version, items)

    plugins = []
    for pid, (version, items) in sorted(best.items()):
        assets = []
        for target, path in sorted(items):
            base = args.base_url.rstrip("/")
            assets.append({
                "name": os.path.basename(path),
                "size": os.path.getsize(path),
                "browser_download_url": "%s/%s" % (base, os.path.basename(path)),
                "digest": "sha256:" + sha256_of(path),
            })
        plugins.append({
            "id": pid,
            "name": pid,
            "description": "自建分发源",
            "order": args.order,
            "category": "official",
            "providers": [],
            "icon": None,
            "detail": {
                "protocol": args.protocol,
                "homepage": "",
                "release": {
                    "repo": args.repo,
                    "tag": "v{version}",
                    "asset": "{id}-{version}-{target}.zip",
                },
            },
            "release": {
                "tag_name": "v" + version,
                "name": "v" + version,
                "prerelease": "-" in version,
                "published_at": "",
                "body": "",
                "assets": assets,
            },
        })

    catalog = {"schema": 1, "plugins": plugins}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)
    print("已写入 %s：%d 个插件" % (args.out, len(plugins)))
    for plugin in plugins:
        print("  %s %s → %d 个资产" % (plugin["id"], plugin["release"]["tag_name"], len(plugin["release"]["assets"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
