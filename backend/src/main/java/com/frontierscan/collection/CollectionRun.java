package com.frontierscan.collection;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.OffsetDateTime;

/**
 * 采集任务运行记录实体，映射数据库 {@code collection_runs} 表。
 * <p>跟踪每次采集任务的执行状态、耗时和采集数量，用于监控和审计。</p>
 */
@Data @NoArgsConstructor @AllArgsConstructor
@Entity @Table(name = "collection_runs")
public class CollectionRun {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "user_id", nullable = false)
    private Long userId;
    @Column(name = "site_id")
    private Long siteId;
    @Column(name = "run_type", nullable = false, length = 40)
    private String runType;
    @Column(nullable = false, length = 40)
    private String status;
    @Column(name = "started_at", nullable = false)
    private OffsetDateTime startedAt;
    @Column(name = "finished_at")
    private OffsetDateTime finishedAt;
    @Column(name = "collected_count", nullable = false)
    private Integer collectedCount = 0;
    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /** 当前任务的自动重试序号：原始任务为 0，第 1/2/3 次自动重试分别为 1/2/3。 */
    @Column(name = "retry_count", nullable = false)
    private Integer retryCount = 0;

    /** 结构化失败类型，用于前端快速区分网络、RSS、HTML、空结果等失败。 */
    @Column(name = "failure_type", length = 80)
    private String failureType;

    /** 失败发生阶段，用于定位是 RSS、HTML、LLM 摘要还是未知阶段。 */
    @Column(name = "failure_stage", length = 80)
    private String failureStage;

    /** 本次失败任务的下一次自动重试时间，超过最大重试次数时为空。 */
    @Column(name = "next_retry_at")
    private OffsetDateTime nextRetryAt;

    /** 当前任务是由哪个失败任务重试产生的；原始任务为空。 */
    @Column(name = "retry_of_run_id")
    private Long retryOfRunId;

    /** 非阻断告警信息，例如 LLM 摘要部分失败但文章采集已成功。 */
    @Column(name = "warning_message", columnDefinition = "TEXT")
    private String warningMessage;
}
