package com.frontierscan.llm.tag;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

/**
 * 文章标签关联数据访问接口。
 * <p>
 * 提供按文章查询标签、批量删除和批量插入能力。
 * 多个领域共用一个关联表，通过 {@code tagDomain} 字段区分。
 * </p>
 */
public interface ArticleTagMappingRepository extends JpaRepository<ArticleTagMapping, Long> {

    /** 查询指定文章的所有标签关联。 */
    List<ArticleTagMapping> findByArticleId(Long articleId);

    /** 删除指定文章的所有标签关联（用于重新评估时覆盖旧标签）。 */
    @Modifying
    @Query("delete from ArticleTagMapping m where m.articleId = :articleId")
    void deleteByArticleId(@Param("articleId") Long articleId);

    /**
     * 查询指定标签关联的所有文章 ID，用于收藏页按标签筛选时做内存过滤。
     */
    @Query("select m.articleId from ArticleTagMapping m where m.tagId = :tagId")
    List<Long> findArticleIdsByTagId(@Param("tagId") Long tagId);
}
