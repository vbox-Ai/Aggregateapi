#!/usr/bin/env python3
"""C 方案补丁：让网关用"自身二进制 + --serve-pack"当插件进程。

不依赖具体文件路径：全仓搜索含 `HostOptions::new(exe)` 的 Rust 源码再改写。

用法：patch-inproc.py <上游源码根>
"""
import pathlib
import sys

root = pathlib.Path(sys.argv[1])

OLD = """    let options = HostOptions {
        cwd: exe.parent().map(std::path::Path::to_path_buf),
        data_dir: install::plugins_dir().join(&pack.id).display().to_string(),
        init_timeout: Duration::from_secs(30),
        loopback_port: loopback_port(),
        ..HostOptions::new(exe)
    };"""

NEW = """    let mut options = HostOptions {
        cwd: exe.parent().map(std::path::Path::to_path_buf),
        data_dir: install::plugins_dir().join(&pack.id).display().to_string(),
        init_timeout: Duration::from_secs(30),
        loopback_port: loopback_port(),
        ..HostOptions::new(exe)
    };

    // ── 内嵌 provider（iOS / RootHide）────────────────────────────
    // 这类环境拒绝对"未被越狱工具重签"的二进制做 exec，插件包里的 exe
    // 永远起不来。daemon 自身被重签过，所以让它 exec 自己、用
    // `--serve-pack` 切到插件形态，协议完全不变。
    if std::env::var("AGENT2API_INPROC").map(|v| v.trim() != "0").unwrap_or(true) {
        match std::env::current_exe() {
            Ok(self_exe) => {
                options.exe = self_exe.clone();
                options.args = vec!["--serve-pack".to_string()];
                logging::log(
                    "Plugin",
                    &format!(
                        "使用内嵌 provider：{} --serve-pack（包 {}）",
                        self_exe.display(),
                        pack.id
                    ),
                );
            }
            Err(error) => logging::log(
                "Plugin",
                &format!("取不到自身路径，回退到插件 exe：{error}"),
            ),
        }
    }"""

patched = 0
for path in root.rglob("*.rs"):
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    if "HostOptions::new(exe)" not in text:
        continue
    if "使用内嵌 provider" in text:
        print("已打过补丁：", path)
        continue
    if OLD in text:
        path.write_text(text.replace(OLD, NEW, 1), encoding="utf-8")
        print("已打补丁：", path)
        patched += 1
        break

if patched == 0:
    print("未找到匹配的 HostOptions 构造块（上游结构可能已变）")
    sys.exit(1)
