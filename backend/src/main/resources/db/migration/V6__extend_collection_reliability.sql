-- 采集可靠性增强一期：补齐站点健康状态、任务失败分类和自动重试审计字段。
--
-- V5 已经引入连续失败次数、最近失败原因、最近失败时间和 retry_count。
-- 本迁移只追加缺失字段，不修改历史迁移文件，保证已部署环境可以按 Flyway 顺序平滑升级。

ALTER TABLE sites
    ADD COLUMN last_success_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN next_retry_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE collection_runs
    ADD COLUMN failure_type VARCHAR(80),
    ADD COLUMN failure_stage VARCHAR(80),
    ADD COLUMN next_retry_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN retry_of_run_id BIGINT REFERENCES collection_runs(id),
    ADD COLUMN warning_message TEXT;

COMMENT ON COLUMN sites.last_success_at IS '站点最近一次采集成功时间，成功包含新增0篇但链路正常完成';
COMMENT ON COLUMN sites.next_retry_at IS '站点下一次自动重试时间，失败任务超过最大重试次数后为空';
COMMENT ON COLUMN collection_runs.failure_type IS '采集失败类型，例如 NETWORK_TIMEOUT、RSS_PARSE_ERROR、HTML_PARSE_ERROR、EMPTY_RESULT、UNKNOWN';
COMMENT ON COLUMN collection_runs.failure_stage IS '失败发生阶段，例如 RSS、HTML、LLM_SUMMARY、UNKNOWN';
COMMENT ON COLUMN collection_runs.next_retry_at IS '本次失败任务下一次自动重试时间';
COMMENT ON COLUMN collection_runs.retry_of_run_id IS '当前重试任务对应的原失败任务ID';
COMMENT ON COLUMN collection_runs.warning_message IS '非阻断告警信息，例如 LLM 摘要部分失败';
