#!/usr/bin/env python3
"""C 方案补丁：让网关用"自身二进制 + --serve-pack"当插件进程。

原理：RootHide 只拦"未重签的外部可执行文件"的 exec；daemon 自己的二进制
已被转换器重签，exec 自己是被放行的。于是插件进程不再是
`agent2api-web-providers.exe`，而是 `agent2api-server --serve-pack`。

用法：patch-inproc.py <上游源码根>    （环境变量 INPROC=1 时生效，默认开）
"""
import pathlib
import re
import sys

src = pathlib.Path(sys.argv[1])
boot = src / "desktop-tauri/src-tauri/server/src/core/plugin_host/ph_bootstrap.rs"
if not boot.exists():
    # 兼容其它目录布局
    hits = list(src.rglob("ph_bootstrap.rs"))
    if not hits:
        print("找不到 ph_bootstrap.rs")
        sys.exit(1)
    boot = hits[0]

text = boot.read_text(encoding="utf-8")
if "a2a_inproc_exe" in text:
    print("补丁已存在，跳过")
    sys.exit(0)

old = """    let options = HostOptions {
        cwd: exe.parent().map(std::path::Path::to_path_buf),
        data_dir: install::plugins_dir().join(&pack.id).display().to_string(),
        init_timeout: Duration::from_secs(30),
        loopback_port: loopback_port(),
        ..HostOptions::new(exe)
    };"""
if old not in text:
    print("未命中 HostOptions 构造块，源码可能已变更")
    sys.exit(1)

new = """    let mut options = HostOptions {
        cwd: exe.parent().map(std::path::Path::to_path_buf),
        data_dir: install::plugins_dir().join(&pack.id).display().to_string(),
        init_timeout: Duration::from_secs(30),
        loopback_port: loopback_port(),
        ..HostOptions::new(exe)
    };

    // ── 内嵌 provider（iOS / RootHide）────────────────────────────
    // 这些环境会拒绝对"未被越狱工具重签"的二进制做 exec，插件包里的 exe
    // 永远起不来。daemon 自身是被重签过的，所以让它 exec 自己、用
    // `--serve-pack` 切到"插件形态"，协议完全不变。
    if std::env::var("AGENT2API_INPROC").map(|v| v.trim() != "0").unwrap_or(true) {
        if let Ok(self_exe) = std::env::current_exe() {
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
    }"""

boot.write_text(text.replace(old, new, 1), encoding="utf-8")
print("已打补丁：插件进程改为 daemon 自身 --serve-pack")
