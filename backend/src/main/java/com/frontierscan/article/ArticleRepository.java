package com.frontierscan.article;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
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

    /** 检查某篇文章是否已存在（全局 sourceHash，用于跨用户去重）。 */
    boolean existsBySourceHash(String sourceHash);

    /** 统计指定用户的文章总数。 */
    long countByUserId(Long userId);

    long countByUserIdAndCategoryId(Long userId, Long categoryId);

    boolean existsByUserIdAndCategoryId(Long userId, Long categoryId);

    /** 统计指定用户在指定时间之后的文章数（用于"今日采集"指标）。 */
    long countByUserIdAndCollectedAtAfter(Long userId, OffsetDateTime after);

    /**
     * 查询长时间停留在 PENDING 且尚未生成摘要的文章。
     * <p>
     * 用于自动恢复采集增强阶段被服务重启、批量超时或线程中断遗留的文章，避免只能依赖用户手动点击
     * “重新生成摘要”。
     * </p>
     */
    @Query("""
            select a from Article a
            where a.summaryStatus = :status
            and (a.summary is null or trim(a.summary) = '')
            and (a.summaryLastAttemptAt is null or a.summaryLastAttemptAt < :attemptBefore)
            and a.collectedAt < :collectedBefore
            order by a.collectedAt asc
            """)
    List<Article> findStalePendingSummaries(@Param("status") String status,
                                            @Param("attemptBefore") OffsetDateTime attemptBefore,
                                            @Param("collectedBefore") OffsetDateTime collectedBefore,
                                            Pageable pageable);

    /**
     * ????????????????????????????????
     * ????????????? SQL + cast ?????????
     * ?? PostgreSQL ? null ??????????
     */
    @Query(value = """
            select * from articles a
            where a.user_id = :userId
            and (:categoryId is null or a.category_id = :categoryId)
            and (:siteId is null or a.site_id = :siteId)
            and (:keywordPattern is null or lower(a.title) like :keywordPattern or lower(a.summary) like :keywordPattern)
            and (cast(:tagId as bigint) is null or exists (select 1 from article_tags m where m.article_id = a.id and m.tag_id = cast(:tagId as bigint)))
            and (cast(:startDate as timestamp with time zone) is null or a.published_at >= cast(:startDate as timestamp with time zone))
            and (cast(:endDate as timestamp with time zone) is null or a.published_at <= cast(:endDate as timestamp with time zone))
            order by a.collected_at desc
            """,
            countQuery = """
            select count(*) from articles a
            where a.user_id = :userId
            and (:categoryId is null or a.category_id = :categoryId)
            and (:siteId is null or a.site_id = :siteId)
            and (:keywordPattern is null or lower(a.title) like :keywordPattern or lower(a.summary) like :keywordPattern)
            and (cast(:tagId as bigint) is null or exists (select 1 from article_tags m where m.article_id = a.id and m.tag_id = cast(:tagId as bigint)))
            and (cast(:startDate as timestamp with time zone) is null or a.published_at >= cast(:startDate as timestamp with time zone))
            and (cast(:endDate as timestamp with time zone) is null or a.published_at <= cast(:endDate as timestamp with time zone))
            """,
            nativeQuery = true)
    Page<Article> findWithFilters(@Param("userId") Long userId, @Param("categoryId") Long categoryId,
            @Param("siteId") Long siteId, @Param("keywordPattern") String keywordPattern, @Param("tagId") Long tagId,
            @Param("startDate") String startDate, @Param("endDate") String endDate, Pageable pageable);

}
