package com.frontierscan.article;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 收藏数据访问接口。
 * <p>
 * 提供按用户查询收藏列表、检查收藏状态和删除收藏的功能。
 * </p>
 */
public interface FavoriteRepository extends JpaRepository<Favorite, Long> {

    /** 查询指定用户的所有收藏（按收藏时间倒序）。 */
    List<Favorite> findByUserIdOrderByCreatedAtDesc(Long userId);

    /**
     * 查询指定用户收藏的文章视图。
     * <p>
     * 同时按 {@code Favorite.userId} 和 {@code Article.userId} 过滤，确保收藏关系和文章本体
     * 都属于当前用户，避免历史脏数据或手工写库造成跨用户文章泄露。
     * </p>
     *
     * @param userId 当前用户 ID
     * @return 收藏文章视图列表，按收藏时间倒序
     */
    @Query("""
            select new com.frontierscan.article.FavoriteArticleView(
                f.id, a.id, a.title, a.summary, a.keyPoints, a.tags,
                a.sourceUrl, a.publishedAt, a.collectedAt, f.createdAt
            )
            from Favorite f
            join Article a on a.id = f.articleId
            where f.userId = :userId and a.userId = :userId
            order by f.createdAt desc
            """)
    List<FavoriteArticleView> findFavoriteArticleViewsByUserId(@Param("userId") Long userId);

    /** 检查用户是否已收藏某篇文章。 */
    boolean existsByUserIdAndArticleId(Long userId, Long articleId);

    /** 取消用户对某篇文章的收藏。 */
    void deleteByUserIdAndArticleId(Long userId, Long articleId);

    /**
     * ?????????????????????????????????????
     * ???????????
     */
    @Query("""
            select new com.frontierscan.article.FavoriteArticleView(
                f.id, a.id, a.title, a.summary, a.keyPoints, a.tags,
                a.sourceUrl, a.publishedAt, a.collectedAt, f.createdAt
            )
            from Favorite f
            join Article a on a.id = f.articleId
            where f.userId = :userId and a.userId = :userId
            and (:keyword is null or locate(:keyword, a.title) > 0 or locate(:keyword, a.summary) > 0)
            and (:startDate is null or a.publishedAt >= :startDate)
            and (:endDate is null or a.publishedAt <= :endDate)
            order by f.createdAt desc
            """)
    List<FavoriteArticleView> findFavoriteArticleViewsByUserIdWithFilters(
            @Param("userId") Long userId,
            @Param("keyword") String keyword,
            @Param("startDate") OffsetDateTime startDate,
            @Param("endDate") OffsetDateTime endDate);
}
