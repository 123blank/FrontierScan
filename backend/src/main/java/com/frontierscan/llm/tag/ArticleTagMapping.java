package com.frontierscan.llm.tag;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.OffsetDateTime;

/**
 * 文章标签关联实体，映射 {@code article_tags} 表。
 * <p>
 * 记录文章与标签的多对多关联。通过 {@code tagDomain} 字段区分标签来自哪个领域，
 * 不设外键约束以支持多个领域的标签表。
 * </p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "article_tags", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"article_id", "tag_id", "tag_domain"})
})
public class ArticleTagMapping {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 文章 ID，引用 articles.id。 */
    @Column(name = "article_id", nullable = false)
    private Long articleId;

    /** 标签 ID，对应某个领域标签表中的 ID。 */
    @Column(name = "tag_id", nullable = false)
    private Long tagId;

    /** 标签所属领域名称，与 tag_domains.name 逻辑关联。 */
    @Column(name = "tag_domain", nullable = false, length = 50)
    private String tagDomain;

    /** 记录创建时间。 */
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;
}
