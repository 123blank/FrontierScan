package com.frontierscan.site;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

/**
 * 信息源网站实体，映射数据库 {@code sites} 表。
 * <p>
 * 表示一个待采集的技术/AI 前沿网站，包含 RSS 地址和采集调度参数。
 * 归属于具体用户和分类，支持启停控制。
 * </p>
 */
@Entity
@Table(name = "sites")
public class Site {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 所属用户 ID */
    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 所属分类 ID */
    @Column(name = "category_id", nullable = false)
    private Long categoryId;

    /** 网站名称 */
    @Column(nullable = false, length = 160)
    private String name;

    /** 网站首页 URL */
    @Column(nullable = false, length = 1000)
    private String url;

    /** RSS/Atom 订阅地址（优先使用，缺失时使用网页解析） */
    @Column(name = "rss_url", length = 1000)
    private String rssUrl;

    /** 自动采集间隔（分钟），默认 1440 分钟（24 小时） */
    @Column(name = "collection_interval_minutes", nullable = false)
    private Integer collectionIntervalMinutes = 1440;

    /** 是否启用采集（禁用后定时任务跳过此站点） */
    @Column(nullable = false)
    private Boolean enabled = true;

    /** 创建时间 */
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    /** 最后更新时间 */
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public Long getCategoryId() { return categoryId; }
    public void setCategoryId(Long categoryId) { this.categoryId = categoryId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }
    public String getRssUrl() { return rssUrl; }
    public void setRssUrl(String rssUrl) { this.rssUrl = rssUrl; }
    public Integer getCollectionIntervalMinutes() { return collectionIntervalMinutes; }
    public void setCollectionIntervalMinutes(Integer collectionIntervalMinutes) { this.collectionIntervalMinutes = collectionIntervalMinutes; }
    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}