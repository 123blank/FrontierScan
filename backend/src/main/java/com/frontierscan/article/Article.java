package com.frontierscan.article;

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
 * 文章内容实体，映射数据库 {@code articles} 表。
 * <p>存储从信息源采集并经大模型处理后的文章数据。
 * 通过 {@code (userId, sourceHash)} 联合唯一约束实现跨采集去重。</p>
 */
@Data @NoArgsConstructor @AllArgsConstructor
@Entity @Table(name = "articles")
public class Article {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "user_id", nullable = false)
    private Long userId;
    @Column(name = "site_id", nullable = false)
    private Long siteId;
    @Column(name = "category_id", nullable = false)
    private Long categoryId;
    @Column(nullable = false, length = 500)
    private String title;
    @Column(columnDefinition = "TEXT")
    private String summary;
    @Column(name = "key_points", columnDefinition = "TEXT")
    private String keyPoints;
    @Column(length = 1000)
    private String tags;
    @Column(name = "content_excerpt", columnDefinition = "TEXT")
    private String contentExcerpt;
    /**
     * 采集到的清洗后全文正文。
     * <p>
     * 该字段用于摘要 Map-Reduce 和标签语义兜底，不直接在前端详情中展示，避免长文本影响页面性能。
     * 历史文章在 V9 迁移后允许为空，此时摘要链路会回退到 {@link #contentExcerpt}，保证旧数据仍可治理。
     * </p>
     */
    @Column(name = "content_full", columnDefinition = "TEXT")
    private String contentFull;
    /**
     * 文章级 LLM 摘要状态。
     * <p>该状态用于区分待生成、已生成、生成失败和质量不佳，前端详情抽屉据此展示治理提示和重试入口。</p>
     */
    @Column(name = "summary_status", nullable = false, length = 40)
    private String summaryStatus = "PENDING";
    /**
     * 摘要质量规则评分，满分 100。
     * <p>一期不额外调用大模型评审，统一由规则评分器写入该字段，低于阈值时标记为 LOW_QUALITY。</p>
     */
    @Column(name = "summary_quality_score")
    private Integer summaryQualityScore;
    /**
     * 摘要失败或低质量原因。
     * <p>面向用户和运维排障展示，避免只看到“失败”而无法判断是正文缺失、模型空返回还是格式污染。</p>
     */
    @Column(name = "summary_quality_reason", columnDefinition = "TEXT")
    private String summaryQualityReason;
    /**
     * 用户手动重新生成摘要的次数。
     * <p>采集阶段的自动首次生成不累计该值，用于后续观察人工治理成本。</p>
     */
    @Column(name = "summary_retry_count", nullable = false)
    private Integer summaryRetryCount = 0;
    /** 最近一次尝试生成摘要的时间，无论成功、失败或低质量都会更新。 */
    @Column(name = "summary_last_attempt_at")
    private OffsetDateTime summaryLastAttemptAt;
    /** 最近一次成功写入摘要内容的时间，LOW_QUALITY 也表示已有可展示内容，因此会更新。 */
    @Column(name = "summary_updated_at")
    private OffsetDateTime summaryUpdatedAt;
    @Column(name = "source_url", nullable = false, length = 1200)
    private String sourceUrl;
    @Column(name = "source_hash", nullable = false, length = 128)
    private String sourceHash;
    @Column(name = "published_at")
    private OffsetDateTime publishedAt;
    @Column(name = "collected_at", nullable = false)
    private OffsetDateTime collectedAt;
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;
}
