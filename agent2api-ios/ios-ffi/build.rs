//! 链接内嵌 provider 静态库（C 方案）。
//!
//! 走 `-force_load` 而不是 `-l`：静态库只有在符号被引用时才会被摘取，
//! 而 `pack_host_serve` 是通过 extern 声明调用的，链接器有时看不到引用，
//! 结果报 `Undefined symbols: _pack_host_serve`。force_load 强制整包载入，
//! 一次性消除这种不确定性。

fn main() {
    println!("cargo:rerun-if-env-changed=A2A_PACK_LIB_DIR");
    println!("cargo:rerun-if-changed=build.rs");

    let Ok(dir) = std::env::var("A2A_PACK_LIB_DIR") else {
        return;
    };
    let dir = dir.trim().to_string();
    if dir.is_empty() {
        return;
    }

    let archive = format!("{dir}/libpack_host.a");
    if !std::path::Path::new(&archive).exists() {
        // 明确报错，而不是让链接阶段给出难以定位的 undefined symbol
        panic!("A2A_PACK_LIB_DIR 指向的目录里没有 libpack_host.a：{archive}");
    }

    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-arg=-Wl,-force_load,{archive}");
}
