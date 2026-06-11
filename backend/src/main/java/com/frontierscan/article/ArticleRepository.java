package com.frontierscan.article;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 文章数据访问接口。
 * <p>
 * 提供按用户、分类、来源等多维度的分页查询能力，
 * 以及基于 sourceHash 的去重检查功能。
 * </p>
 */
public interface ArticleRepository extends JpaRepository<Article, Long> {

    /** 查询指定用户的最新文章（分页，按采集时间倒序）。 */
    Page<Article> findByUserIdOrderByCollectedAtDesc(Long userId, Pageable pageable);

    /** 查询指定用户在指定分类下的文章（分页）。 */
    Page<Article> findByUserIdAndCategoryIdOrderByCollectedAtDesc(Long userId, Long categoryId, Pageable pageable);

    /** 查询指定用户在指定来源网站下的文章（分页）。 */
    Page<Article> findByUserIdAndSiteIdOrderByCollectedAtDesc(Long userId, Long siteId, Pageable pageable);

    /** 根据内容哈希查询已有文章（用于去重判断）。 */
    List<Article> findByUserIdAndSourceHash(Long userId, String sourceHash);

    /** 检查某篇文章是否已存在（按用户 + 内容哈希）。 */
    boolean existsByUserIdAndSourceHash(Long userId, String sourceHash);

    /** 统计指定用户的文章总数。 */
    long countByUserId(Long userId);

    /** 统计指定用户在指定时间之后的文章数（用于"今日采集"指标）。 */
    long countByUserIdAndCollectedAtAfter(Long userId, OffsetDateTime after);
}