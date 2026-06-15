package com.frontierscan.site;

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
 * 信息源网站实体，映射数据库 {@code sites} 表。
 * <p>表示待采集的技术/AI 前沿网站，包含 RSS 地址和采集调度参数。</p>
 */
@Data @NoArgsConstructor @AllArgsConstructor
@Entity @Table(name = "sites")
public class Site {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "user_id", nullable = false)
    private Long userId;
    @Column(name = "category_id", nullable = false)
    private Long categoryId;
    @Column(nullable = false, length = 160)
    private String name;
    @Column(nullable = false, length = 1000)
    private String url;
    @Column(name = "rss_url", length = 1000)
    private String rssUrl;
    @Column(name = "collection_interval_minutes", nullable = false)
    private Integer collectionIntervalMinutes = 1440;
    @Column(nullable = false)
    private Boolean enabled = true;
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    /** 连续采集失败次数，超过阈值时跳过定时调度。 */
    @Column(name = "consecutive_failures", nullable = false)
    private Integer consecutiveFailures = 0;

    /** 最近一次失败的详细原因。 */
    @Column(name = "last_failure_reason", columnDefinition = "TEXT")
    private String lastFailureReason;

    /** 最近一次失败的时间。 */
    @Column(name = "last_failure_at")
    private OffsetDateTime lastFailureAt;

    /** 最近一次采集链路成功完成的时间，新增 0 篇但无采集异常也视为成功。 */
    @Column(name = "last_success_at")
    private OffsetDateTime lastSuccessAt;

    /** 最近一次失败任务计算出的下一次自动重试时间，超过最大重试次数后为空。 */
    @Column(name = "next_retry_at")
    private OffsetDateTime nextRetryAt;
}
