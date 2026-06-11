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
 * 用户收藏关系实体，映射数据库 {@code favorites} 表。
 * <p>通过 {@code (userId, articleId)} 联合唯一约束防止重复收藏。</p>
 */
@Getter @Setter @NoArgsConstructor @AllArgsConstructor
@Entity @Table(name = "favorites")
public class Favorite {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "user_id", nullable = false)
    private Long userId;
    @Column(name = "article_id", nullable = false)
    private Long articleId;
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;
}