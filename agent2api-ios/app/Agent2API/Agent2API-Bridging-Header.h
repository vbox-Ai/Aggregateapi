//
// Agent2API-Bridging-Header.h
//
// 只在 EMBED=1（形态 A2，网关进程内运行）时参与编译。
// 声明来自 ios-ffi/src/lib.rs 的 C ABI，供 Swift 直接调用。
//
#ifndef AGENT2API_BRIDGING_HEADER_H
#define AGENT2API_BRIDGING_HEADER_H

#include <stdint.h>

/// 启动网关。home/ui_dir 为 NUL 结尾 UTF-8；port 传 0 用默认 3065。
/// 返回 0 成功；-1 bootstrap 失败；-2 端口占用；-3 已在运行。
int32_t a2a_start(const char *home, const char *ui_dir, uint16_t port);

/// 优雅停机。0 = 已发出信号，-1 = 未运行。
int32_t a2a_stop(void);

/// 是否已由本库启动（1/0，-1 异常）。
int32_t a2a_is_running(void);

/// 数据目录里的 agent2api.db 绝对路径（需 a2a_free_string 释放）。
char *a2a_db_path(void);

/// 释放 a2a_db_path 返回的内存。
void a2a_free_string(char *p);

// 取走最近一次失败原因（内部是 CString，需用 a2a_free_string 释放）
char *a2a_last_error(void);

#endif /* AGENT2API_BRIDGING_HEADER_H */
