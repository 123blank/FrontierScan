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
}