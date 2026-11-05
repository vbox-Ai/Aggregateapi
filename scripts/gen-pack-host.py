#!/usr/bin/env python3
"""生成 pack_host crate 的 Cargo.toml。

pack_host 需要：
  · provider crate（path 依赖，绝对路径）
  · agent2api-provider-sdk（版本与 provider crate 保持一致，避免两份 SDK）
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

# provider crate 里 SDK 的依赖声明（保留版本/特性写法）
sdk_dep = None
for line in text.splitlines():
    stripped = line.strip()
    if stripped.startswith("agent2api-provider-sdk"):
        sdk_dep = stripped
        break
if sdk_dep is None:
    sdk_dep = 'agent2api-provider-sdk = "*"'

if features:
    prov_dep = '%s = { path = "%s", default-features = false, features = [%s] }' % (
        name, crate.as_posix(), ", ".join('"%s"' % f for f in features))
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
