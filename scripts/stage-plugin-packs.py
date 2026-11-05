#!/usr/bin/env python3
"""把编译好的插件 zip 摊成"deb 里预置"的目录 + 注册表。

为什么要这一步：
  面板里的「网关插件」走的是 GitHub 下载 + ed25519 官方验签；
  自建包没有官方签名，国内网络又只能走加速镜像（镜像通道强制验签），
  所以点「下载并安装 / 补齐插件」必然报
  「加速下载的插件未通过官方签名校验」。
  直接把插件目录塞进 deb、postinst 落到网关的 plugins/ 并写好注册表，
  就绕开了下载与验签两条路径 —— 装上即可用。

产物：
  {out}/{pack_id}/{version}/...   解包后的包目录（pack.json + 入口二进制）
  {out}/plugins.json              网关的包注册表（PackRegistry）

注册表字段与网关 install.rs 的 InstalledPack 一一对应：
  id / version / enabled / providers / entry / sha256 / signed / installed_at /
  manifest_providers

用法：
  python3 scripts/stage-plugin-packs.py --out out/stage-packs \
      out/packs/agent2api-providers-3.4.4-aarch64-unknown-linux-gnu.zip \
      out/packs/agent2api-web-providers-3.4.4-aarch64-unknown-linux-gnu.zip
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import sys
import time
import zipfile

TARGET = "aarch64-unknown-linux-gnu"


def load_manifest(pack_dir: pathlib.Path) -> dict:
    return json.loads((pack_dir / "pack.json").read_text(encoding="utf-8"))


def stage(zip_path: pathlib.Path, out: pathlib.Path) -> dict:
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(out)

    # zip 里可能套了一层目录（打包工具的差异）：pack.json 在哪，包根就是哪
    root = out
    if not (root / "pack.json").is_file():
        nested = list(out.glob("*/pack.json"))
        if not nested:
            raise SystemExit(f"❌ {zip_path.name} 里找不到 pack.json")
        root = nested[0].parent

    manifest = load_manifest(root)
    pack_id = manifest["id"]
    version = manifest["version"]

    entry = (manifest.get("entry") or {}).get(TARGET)
    if not entry:
        values = list((manifest.get("entry") or {}).values())
        if not values:
            raise SystemExit(f"❌ {pack_id} 的 pack.json 没有 entry")
        entry = values[0]

    exe = root / entry
    if not exe.is_file():
        raise SystemExit(f"❌ {pack_id} 的入口不存在：{entry}")
    exe.chmod(0o755)

    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()

    return {
        "id": pack_id,
        "version": version,
        "enabled": True,
        "providers": {
            item["id"]: bool(item.get("default_enabled", True))
            for item in manifest.get("providers", [])
            if item.get("id")
        },
        "entry": entry,
        "sha256": digest,
        "signed": False,
        "installed_at": int(time.time() * 1000),
        "manifest_providers": manifest.get("providers", []),
        "_root": root,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="out/stage-packs")
    parser.add_argument("zips", nargs="+")
    args = parser.parse_args()

    out = pathlib.Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    work = out / ".work"
    work.mkdir(exist_ok=True)

    packs = []
    for index, name in enumerate(args.zips):
        zip_path = pathlib.Path(name)
        if not zip_path.is_file():
            raise SystemExit(f"❌ 找不到插件包：{zip_path}")
        scratch = work / str(index)
        scratch.mkdir()
        record = stage(zip_path, scratch)
        root = record.pop("_root")

        # 落到 {out}/{id}/{version}/，与网关的目录布局一致
        dest = out / record["id"] / record["version"]
        if dest.exists():
            shutil.rmtree(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(root), str(dest))
        packs.append(record)

    shutil.rmtree(work, ignore_errors=True)
    packs.sort(key=lambda item: item["id"])
    registry = {"packs": packs}
    (out / "plugins.json").write_bytes(
        (json.dumps(registry, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    )

    for record in packs:
        print(f"[stage] {record['id']} v{record['version']} entry={record['entry']} "
              f"providers={len(record['providers'])} sha256={record['sha256'][:12]}…")
    print(f"[stage] 注册表：{out / 'plugins.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
