//! 链接内嵌 provider 静态库（C 方案）。
//!
//! 只有在 CI 传了 A2A_PACK_LIB_DIR 时才链接；本地普通构建不受影响。

fn main() {
    println!("cargo:rerun-if-env-changed=A2A_PACK_LIB_DIR");
    if let Ok(dir) = std::env::var("A2A_PACK_LIB_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            println!("cargo:rustc-link-search=native={dir}");
            println!("cargo:rustc-link-lib=static=pack_host");
        }
    }
}
