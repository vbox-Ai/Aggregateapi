-- ── assistant_files：助手文件库（schema v30）────────────────────────────
--
-- 为什么需要这张表：操作者会往助手里丢**上百个文件、上百 MB 的 zip**。内联进
-- 消息那条路（前端 MAX_TEXT_FILES=3 / MAX_TEXT_FILE_BYTES=512 KiB）是它自身的
-- 必然边界，装不下这种体量；于是 zip 由网关侧解包、**逐条入库**，消息历史里只留
-- 文件 ID，助手按需**分页**读。
--
-- 与 assistant_images 同构（`schema_assistant_images.sql`，version 19）：都是
-- "字节在库里、ID 在消息里、会话删了一起删"。区别只有体量与读取方式：
--   · 总量上限 2 GiB（图片是 512 MiB）—— 这张表的用途就是装大包；
--   · 读取走 `substr(bytes, offset, limit)` **在库内切片**，一次只把请求的那
--     一段带回内存，于是峰值内存与文件大小无关。这也是为什么用 BLOB 而不是外部
--     文件：切片、事务、随会话删除三件事都白拿。
--
-- 会话外键：与 assistant_images 同口径 —— 会话被删时这些行由调用方一并清掉
-- （`core::assistant_files::delete_session`），不依赖数据库层 CASCADE，
-- 以免与既有表的删除时机分叉。
CREATE TABLE IF NOT EXISTS assistant_files (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);

-- 按会话列清单是最常走的一条（导入后立刻列表、会话清理时按会话删）。
CREATE INDEX IF NOT EXISTS idx_assistant_files_session ON assistant_files (session_id, created_at);
