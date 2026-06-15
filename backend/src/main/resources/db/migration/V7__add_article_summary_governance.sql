-- LLM 摘要治理一期：为文章增加摘要状态、质量评分和重试审计字段。
--
-- 这些字段属于文章级治理状态，不能只放在 collection_runs.warning_message 中；
-- 因为用户在阅读详情页需要知道单篇文章当前摘要是否可用、是否低质量，以及是否可以重新生成。
ALTER TABLE articles
    ADD COLUMN summary_status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN summary_quality_score INT,
    ADD COLUMN summary_quality_reason TEXT,
    ADD COLUMN summary_retry_count INT NOT NULL DEFAULT 0,
    ADD COLUMN summary_last_attempt_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN summary_updated_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN articles.summary_status IS '文章级摘要状态：PENDING待生成、COMPLETED合格、FAILED生成失败、LOW_QUALITY质量不佳';
COMMENT ON COLUMN articles.summary_quality_score IS '摘要质量规则评分，满分100，低于70判定为LOW_QUALITY';
COMMENT ON COLUMN articles.summary_quality_reason IS '摘要失败或低质量原因，用于详情页提示和新人排查';
COMMENT ON COLUMN articles.summary_retry_count IS '用户手动重新生成摘要的累计次数';
COMMENT ON COLUMN articles.summary_last_attempt_at IS '最近一次尝试调用LLM生成摘要的时间';
COMMENT ON COLUMN articles.summary_updated_at IS '最近一次成功写入LLM摘要内容的时间，LOW_QUALITY也会记录';
