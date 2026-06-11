package com.frontierscan.article;

import org.springframework.data.jpa.repository.JpaRepository;
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

    /** 检查用户是否已收藏某篇文章。 */
    boolean existsByUserIdAndArticleId(Long userId, Long articleId);

    /** 取消用户对某篇文章的收藏。 */
    void deleteByUserIdAndArticleId(Long userId, Long articleId);
}