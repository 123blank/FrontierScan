-- 采集可靠性增强：站点失败追踪 + 任务重试计数
--
-- 添加字段用于追踪站点连续失败次数和最近一次失败信息，
-- 支持采集器在连续失败时跳过调度，用户可在前端查看原因并手动重试。

ALTER TABLE sites
    ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0,
    ADD COLUMN last_failure_reason TEXT,
    ADD COLUMN last_failure_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE collection_runs
    ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
