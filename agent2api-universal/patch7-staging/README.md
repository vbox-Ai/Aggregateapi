# patch7 暂存区（0007 · 助手文件库 / 100 MB zip 导入）

这里的文件**不是**生效代码，也不会影响任何构建（CI 只取上游源码 + `agent2api-universal/patches/*.diff`）。
它们是为 `0007-assistant-file-import.diff` 准备好的产物，等生成补丁时使用。

## 为什么必须先暂存在这里

本仓库**不含网关 Rust 源码**（`desktop-tauri/src-tauri/server` 不在库里），网关改动
只能以**补丁**形式提交（`patches/0001..0006` 已是这条链）。所以新代码先放这里，
再由补丁把它落到上游树里。

## 内容与落点

| 本目录文件 | 补丁内的落点 |
|---|---|
| `assistant_files.rs` | `server/src/server/core/assistant_files.rs`（新增）|
| `assistant_files_api.rs` | `server/src/server/api/assistant_files.rs`（新增）|
| `schema_assistant_files.sql` | `server/src/server/db/schema_assistant_files.sql`（新增）|
| `EDITS.md` | 四个待改文件的**逐字锚点**与验证要求（不在补丁里，是给生成补丁的人看的）|

## 生成补丁的纪律（EDITS.md 里也写了）

1. 对**干净上游树**（`Agent2API-3.5.0-beta.1`）干跑应用，确认 hunk 全部命中；
2. 每个 hunk 头部的行数**逐行复核**（历史上出过"少算一行"导致 CI 白跑一轮的坑）；
3. Rust 本地无法编译（本机无 cargo）⇒ 编译验证交给 CI。

## 未完成（生成补丁后继续）

- ④ 前端共享层 `ui-shared/assistant-account-import-tools.ts`（第 138 / 352 行的
  `read_attachment` 定义）改为**优先读新库**，消息内联那条路保留并存；
- ⑤ 手机端：选 zip → 带进度 multipart 直传 → 展示解包结果（成功 N / 跳过 M 及原因）。
