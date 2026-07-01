-- ============================================================
-- V10: source_hash 全局去重
-- ============================================================
-- source_hash 已改为基于规范化 URL 生成，代表文章来源身份。
-- 为避免同一篇文章跨用户、跨 RSS/HTML 链路重复入库和重复执行 LLM 增强，
-- 将唯一约束从 (user_id, source_hash) 提升为 source_hash 全局唯一。
--
-- 注意：如果生产库历史上已经存在跨用户重复 source_hash，本迁移会失败；
-- 需要先合并或清理重复数据后再执行。
-- ============================================================

alter table articles
    drop constraint if exists articles_user_id_source_hash_key;

alter table articles
    add constraint articles_source_hash_key unique (source_hash);
