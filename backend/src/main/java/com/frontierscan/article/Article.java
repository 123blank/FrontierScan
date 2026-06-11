package com.frontierscan.article;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

/**
 * 文章内容实体，映射数据库 {@code articles} 表。
 * <p>
 * 存储从信息源采集并经大模型处理后的文章数据。
 * 包含标题、摘要、关键要点、标签和原文链接等信息。
 * 通过 {@code (userId, sourceHash)} 联合唯一约束实现跨采集的去重机制。
 * </p>
 */
@Entity
@Table(name = "articles")
public class Article {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 所属用户 ID */
    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 来源网站 ID */
    @Column(name = "site_id", nullable = false)
    private Long siteId;

    /** 所属分类 ID */
    @Column(name = "category_id", nullable = false)
    private Long categoryId;

    /** 文章标题 */
    @Column(nullable = false, length = 500)
    private String title;

    /** 大模型生成的摘要（3-5 句） */
    @Column(columnDefinition = "TEXT")
    private String summary;

    /** 关键要点列表（JSON 数组或换行分隔） */
    @Column(name = "key_points", columnDefinition = "TEXT")
    private String keyPoints;

    /** 标签列表（逗号分隔） */
    @Column(length = 1000)
    private String tags;

    /** 正文片段 */
    @Column(name = "content_excerpt", columnDefinition = "TEXT")
    private String contentExcerpt;

    /** 原文地址 */
    @Column(name = "source_url", nullable = false, length = 1200)
    private String sourceUrl;

    /** 内容哈希（用于去重） */
    @Column(name = "source_hash", nullable = false, length = 128)
    private String sourceHash;

    /** 原文发布时间 */
    @Column(name = "published_at")
    private OffsetDateTime publishedAt;

    /** 采集时间 */
    @Column(name = "collected_at", nullable = false)
    private OffsetDateTime collectedAt;

    /** 记录创建时间 */
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    // ----- getters / setters -----
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getSiteId() { return siteId; }
    public void setSiteId(Long siteId) { this.siteId = siteId; }
    public Long getCategoryId() { return categoryId; }
    public void setCategoryId(Long categoryId) { this.categoryId = categoryId; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }
    public String getKeyPoints() { return keyPoints; }
    public void setKeyPoints(String keyPoints) { this.keyPoints = keyPoints; }
    public String getTags() { return tags; }
    public void setTags(String tags) { this.tags = tags; }
    public String getContentExcerpt() { return contentExcerpt; }
    public void setContentExcerpt(String contentExcerpt) { this.contentExcerpt = contentExcerpt; }
    public String getSourceUrl() { return sourceUrl; }
    public void setSourceUrl(String sourceUrl) { this.sourceUrl = sourceUrl; }
    public String getSourceHash() { return sourceHash; }
    public void setSourceHash(String sourceHash) { this.sourceHash = sourceHash; }
    public OffsetDateTime getPublishedAt() { return publishedAt; }
    public void setPublishedAt(OffsetDateTime publishedAt) { this.publishedAt = publishedAt; }
    public OffsetDateTime getCollectedAt() { return collectedAt; }
    public void setCollectedAt(OffsetDateTime collectedAt) { this.collectedAt = collectedAt; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }
}