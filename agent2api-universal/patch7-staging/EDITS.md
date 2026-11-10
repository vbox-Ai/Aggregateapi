# 0007-assistant-file-import.diff — 改动清单（照此生成补丁）

上游基线：`up-350b1/Agent2API-3.5.0-beta.1/desktop-tauri/src-tauri/`
补丁落点：`agent2api-universal/patches/0007-assistant-file-import.diff`
应用方式：CI 取上游源码后 `git apply`（与 0001-0006 同一条链）

> 本机没有 cargo/git ⇒ **Rust 不能本地编译**。所以补丁生成后必须做：
> ① 对干净上游树**干跑应用**；② 每个 hunk 头部的行数用"逐行计数"复核
> （历史上这里出过一次 hunk 头少算一行的坑）。

---

## 新增文件（3 个，已在 `_patch7/` 写好）

| 补丁内路径 | 来源文件 | 内容 |
|---|---|---|
| `server/src/server/core/assistant_files.rs` | `_patch7/assistant_files.rs`（9,475 B）| 存储层：install/database/available、store_unpacked、list、**read（SQL 内 substr 分页）**、delete_session、delete；2 GiB 上限 / 507 |
| `server/src/server/api/assistant_files.rs` | `_patch7/assistant_files_api.rs`（11,977 B）| HTTP 层：upload（multipart → tempfile → ZipArchive 逐条入库）、list、read（分页 + `x-total-bytes` 头）、delete |
| `server/src/server/db/schema_assistant_files.sql` | `_patch7/schema_assistant_files.sql`（1,893 B）| 建表 + 索引（schema **v30**）|

## 修改文件（4 处，均为"加一行/改一个数字"级别）

### 1) `server/src/server/db/schema.rs` — 版本号 + 挂载

改动 A（第 350 行附近，逐字）：
```
- pub const SCHEMA_VERSION: i64 = 29;
+ pub const SCHEMA_VERSION: i64 = 30;
```

改动 B（在第 1089 行 `29 => …` 之后、`_ => Ok(()),` 之前插入一行）：
```
         29 => conn.execute_batch(include_str!("schema_usage_query.sql")),
+        30 => conn.execute_batch(include_str!("schema_assistant_files.sql")),
         _ => Ok(()),
```
说明：新版本一律走 `include_str!("schema_xxx.sql")` 独立 SQL 文件（v19/v24/v25/v26/v27/v28/v29 都是这个形态），**不要**写内联 `V30_SCHEMA` 常量。

### 2) `server/src/server/http.rs` — 三条路由

在 `api::assistant_images` 那一组之后（第 633 行 `.../images/files/{id}` 之后）插入：
```
        .route("/api/assistant/images/files/{id}", get(api::assistant_images::download))
+        .route("/api/assistant/files", get(api::assistant_files::list).post(api::assistant_files::upload))
+        .route("/api/assistant/files/{id}", get(api::assistant_files::read).delete(api::assistant_files::delete))
```
说明：这一组已挂在 `protected` 分组里（该分组负责鉴权），所以处理函数内**不再自行校验**；会话标识从 `x-session-id` / `x-assistant-session` 头取（见 API 层的 `session_id`）。

### 3) `server/src/server/core/mod.rs` — 模块注册

第 74 行 `pub mod assistant_images;` 后面加：
```
 pub mod assistant_images;
+pub mod assistant_files;
```

### 4) `server/src/server/api/mod.rs` — 模块注册

第 52 行 `pub mod assistant_images;` 后面加：
```
 pub mod assistant_images;
+pub mod assistant_files;
```

---

## 仍未做（下一轮/后续）

- **④ `read_attachment` 改为优先读新库**：改点在 `server/src/server/config/assistant_config.rs`
  的工具表 + 该工具的实现处（**消息内联那条路保留并存**，不破坏现状）。需要先读工具实现所在文件，
  确认它现在从哪里取附件文本。
- **⑤ 手机端**：`desktop-tauri/mobile/src/lib/assistant-attachments.ts`（`ATTACHMENT_ACCEPT`
  与 `isTextAttachment` **同步**加 zip，否则会出现"选了却没反应"）+ 带进度 multipart 直传 +
  解包结果展示（成功 N / 跳过 M 及原因）。上限 zip 100 MB、条目数百。

## 待 CI 验证的风险点（写的时候按样板推断，无编译器背书）

1. `Multipart::next_field()` / `field.chunk()` 在 axum 0.8 下的签名
2. `entry.by_ref().take(n).read_to_end(&mut buf)` 对 `ZipFile` 可变借用的写法
3. `Db::with` 返回 `Option<Result<T, rusqlite::Error>>` 的嵌套层次（`list` 里用了 `.map_err(|_| ())`）
4. `FileMeta` 的 `serde::Serialize` 派生
5. `ok_json` 的入参形状（`Value` vs `impl Serialize`）
6. `sqlite substr(bytes, ?3, ?4)` 对 BLOB 的返回类型（应为 BLOB）
