package com.frontierscan.article;

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
 * 文章内容实体，映射数据库 {@code articles} 表。
 * <p>存储从信息源采集并经大模型处理后的文章数据。
 * 通过 {@code (userId, sourceHash)} 联合唯一约束实现跨采集去重。</p>
 */
@Getter @Setter @NoArgsConstructor @AllArgsConstructor
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