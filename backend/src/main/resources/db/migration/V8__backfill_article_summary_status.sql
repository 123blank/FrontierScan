-- 摘要治理状态修复：处理已经执行过 V7 的环境。
--
-- V7 初版给 articles.summary_status 设置了默认 PENDING，导致已有 summary 的历史文章
-- 在详情页被展示为“摘要待生成”。本迁移只修复“已有摘要但仍为 PENDING”的记录，
-- 不影响真正尚未生成摘要的新文章。
UPDATE articles
SET summary_status = 'COMPLETED',
    summary_quality_score = COALESCE(summary_quality_score, 100),
    summary_quality_reason = NULL,
    summary_updated_at = COALESCE(summary_updated_at, created_at, collected_at)
WHERE summary_status = 'PENDING'
  AND summary IS NOT NULL
  AND btrim(summary) <> '';
