//! 内嵌 provider 走 Cargo path 依赖（rlib），这里不需要手写链接参数。
//! 保留 A2A_PACK_LIB_DIR 的探测只为在缺失时给出明确报错。

fn main() {
    println!("cargo:rerun-if-env-changed=A2A_PACK_LIB_DIR");
}
