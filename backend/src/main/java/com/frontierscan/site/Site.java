package com.frontierscan.site;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import java.time.OffsetDateTime;

/**
 * 信息源网站实体，映射数据库 {@code sites} 表。
 * <p>表示待采集的技术/AI 前沿网站，包含 RSS 地址和采集调度参数。</p>
 */
@Getter @Setter @NoArgsConstructor @AllArgsConstructor
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
}