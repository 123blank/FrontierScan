package com.frontierscan.collection;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

/**
 * 采集任务运行记录实体，映射数据库 {@code collection_runs} 表。
 * <p>
 * 每次手动或定时采集任务都会生成一条记录，跟踪任务的执行状态、
 * 开始/结束时间、采集数量和错误信息，用于监控和审计。
 * </p>
 */
@Entity
@Table(name = "collection_runs")
public class CollectionRun {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 触发任务的用户 ID */
    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 采集的目标网站 ID（null 表示全量采集） */
    @Column(name = "site_id")
    private Long siteId;

    /** 任务类型：MANUAL（手动）/ SCHEDULED（定时） */
    @Column(name = "run_type", nullable = false, length = 40)
    private String runType;

    /** 任务状态：RUNNING（运行中）/ COMPLETED（完成）/ FAILED（失败） */
    @Column(nullable = false, length = 40)
    private String status;

    /** 任务开始时间 */
    @Column(name = "started_at", nullable = false)
    private OffsetDateTime startedAt;

    /** 任务结束时间 */
    @Column(name = "finished_at")
    private OffsetDateTime finishedAt;

    /** 本次采集到的文章数量 */
    @Column(name = "collected_count", nullable = false)
    private Integer collectedCount = 0;

    /** 失败时的错误信息 */
    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getSiteId() { return siteId; }
    public void setSiteId(Long siteId) { this.siteId = siteId; }
    public String getRunType() { return runType; }
    public void setRunType(String runType) { this.runType = runType; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public OffsetDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(OffsetDateTime startedAt) { this.startedAt = startedAt; }
    public OffsetDateTime getFinishedAt() { return finishedAt; }
    public void setFinishedAt(OffsetDateTime finishedAt) { this.finishedAt = finishedAt; }
    public Integer getCollectedCount() { return collectedCount; }
    public void setCollectedCount(Integer collectedCount) { this.collectedCount = collectedCount; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
}