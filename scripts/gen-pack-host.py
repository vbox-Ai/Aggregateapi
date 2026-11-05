#!/usr/bin/env python3
"""生成 pack_host crate 的 Cargo.toml。

要点：
  · provider crate 用**绝对路径**依赖（Cargo 按清单所在目录解析 path）；
  · SDK 依赖从 provider crate 抄一行，但其中的相对 path 必须就地解析成
    绝对路径 —— 否则 Cargo 会去 pack_host 目录下找 "../provider-sdk"。
"""
import pathlib
import re
import sys

crate = pathlib.Path(sys.argv[1])
host = pathlib.Path(sys.argv[2])
features = [x.strip() for x in sys.argv[3].split(",") if x.strip()]

manifest = crate / "Cargo.toml"
text = manifest.read_text(encoding="utf-8")

name = "agent2api-providers"
m = re.search(r'(?m)^name\s*=\s*"([^"]+)"', text)
if m:
    name = m.group(1)

sdk_dep = None
for line in text.splitlines():
    if line.strip().startswith("agent2api-provider-sdk"):
        sdk_dep = line.strip()
        break
if sdk_dep is None:
    sdk_dep = 'agent2api-provider-sdk = "*"'


def absolutize(dep_line):
    """把依赖行里的相对 path 解析成相对 provider crate 的绝对路径。"""

    def repl(match):
        raw = match.group(1)
        p = pathlib.Path(raw)
        if p.is_absolute():
            return match.group(0)
        return 'path = "%s"' % (crate / p).resolve().as_posix()

    return re.sub(r'path\s*=\s*"([^"]+)"', repl, dep_line)


sdk_dep = absolutize(sdk_dep)

if features:
    prov_dep = '%s = { path = "%s", default-features = false, features = [%s] }' % (
        name,
        crate.as_posix(),
        ", ".join('"%s"' % f for f in features),
    )
else:
    prov_dep = '%s = { path = "%s" }' % (name, crate.as_posix())

(host / "Cargo.toml").write_text(
    f"""[package]
name = "pack_host"
version = "0.1.0"
edition = "2021"

[lib]
name = "pack_host"
crate-type = ["staticlib"]

[dependencies]
{prov_dep}
{sdk_dep}
""",
    encoding="utf-8",
)

print("   provider:", prov_dep)
print("   sdk     :", sdk_dep)
