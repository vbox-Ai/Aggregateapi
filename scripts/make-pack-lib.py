#!/usr/bin/env python3
"""把一个"只有 bin"的 provider crate 变成也有 lib 的 crate。

用法：make-pack-lib.py <crate_dir> <lib_name> <registry_fn>

做三件事：
  1) 生成 src/lib.rs：把 main.rs 的 mod 声明照抄，去掉 crate 级属性与 fn main，
     再追加 `pub fn registry_all()`；
  2) 在 Cargo.toml 里补 [lib]（crate-type = staticlib + rlib）；
  3) 打印确认信息。

为什么不直接依赖 bin crate：Cargo 不能把 bin 当库链进来。
"""
import pathlib
import re
import sys

crate_dir = pathlib.Path(sys.argv[1])
lib_name = sys.argv[2]
registry_fn = sys.argv[3]

main = crate_dir / "src" / "main.rs"
text = main.read_text(encoding="utf-8")

# 去掉 crate 级内部属性（#![...]），它们在 lib.rs 里不合法或会冲突
text = re.sub(r"(?m)^#!\[[^\n]*\]\n", "", text)
# 去掉 doc comment 里的 crate 说明（保留也可，但避免重复 #![doc]）
text = re.sub(r"(?ms)^//!.*?\n(?=\S)", "", text, count=1)

# 去掉 fn main 定义（支持到文件末尾的简单情形）
text = re.sub(r"(?ms)^fn main\(\)\s*\{.*?\n\}\n?", "", text)

lib = text.rstrip() + f"""

/// 给宿主用的注册表（合并进宿主自己的列表）。
pub fn registry_all() -> Vec<Box<dyn agent2api_provider_sdk::Provider>> {{
    {registry_fn}
}}
"""
(crate_dir / "src" / "lib.rs").write_text(lib, encoding="utf-8")

# 补 [lib]
toml = crate_dir / "Cargo.toml"
body = toml.read_text(encoding="utf-8")
if "[lib]" not in body:
    body = body.replace("[package]", "[package]", 1).rstrip() + f"""

[lib]
name = "{lib_name}"
path = "src/lib.rs"
crate-type = ["staticlib", "rlib"]
"""
    toml.write_text(body, encoding="utf-8")
    print(f"[pack] {crate_dir.name}: 已加 [lib] {lib_name}")
else:
    print(f"[pack] {crate_dir.name}: [lib] 已存在")
