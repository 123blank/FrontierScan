-- 摘要全文治理一期：为文章保存采集到的清洗后全文正文。
-- content_excerpt 继续承担列表展示和历史兜底职责；content_full 用于 LLM 摘要 Map-Reduce 与标签语义兜底。
-- 本期不重新抓取历史文章，因此该字段允许为空，旧数据在重新摘要时仍回退到 content_excerpt。
ALTER TABLE articles
    ADD COLUMN content_full TEXT;

COMMENT ON COLUMN articles.content_full IS '采集到的清洗后全文正文，用于LLM全文摘要Map-Reduce和标签语义兜底；历史文章允许为空并回退到content_excerpt';
