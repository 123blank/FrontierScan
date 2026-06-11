package com.frontierscan.article;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 文章管理业务服务。
 * <p>
 * 提供文章的多维度分页查询、收藏管理和统计功能。
 * 所有操作强制绑定 userId，确保用户只能访问自己的数据。
 * </p>
 */
@Service
public class ArticleService {

    private final ArticleRepository articleRepository;
    private final FavoriteRepository favoriteRepository;

    public ArticleService(ArticleRepository articleRepository, FavoriteRepository favoriteRepository) {
        this.articleRepository = articleRepository;
        this.favoriteRepository = favoriteRepository;
    }

    /**
     * 分页查询文章列表，支持按分类和来源网站筛选。
     *
     * @param userId     当前用户 ID
     * @param categoryId 可选分类 ID 筛选
     * @param siteId     可选网站 ID 筛选
     * @param pageable   分页参数
     * @return 分页文章列表
     */
    public Page<Article> listByUser(Long userId, Long categoryId, Long siteId, Pageable pageable) {
        if (categoryId != null) {
            return articleRepository.findByUserIdAndCategoryIdOrderByCollectedAtDesc(userId, categoryId, pageable);
        }
        if (siteId != null) {
            return articleRepository.findByUserIdAndSiteIdOrderByCollectedAtDesc(userId, siteId, pageable);
        }
        return articleRepository.findByUserIdOrderByCollectedAtDesc(userId, pageable);
    }

    /**
     * 获取文章详情，同时校验用户权限。
     *
     * @param userId 当前用户 ID
     * @param id     文章 ID
     * @return 文章对象
     * @throws RuntimeException 如果文章不存在或不属于当前用户
     */
    public Article getById(Long userId, Long id) {
        Article article = articleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("文章不存在"));
        if (!article.getUserId().equals(userId)) {
            throw new RuntimeException("无权访问该文章");
        }
        return article;
    }

    /** 切换收藏状态（已收藏则取消，未收藏则添加）。 */
    public void toggleFavorite(Long userId, Long articleId) {
        if (favoriteRepository.existsByUserIdAndArticleId(userId, articleId)) {
            favoriteRepository.deleteByUserIdAndArticleId(userId, articleId);
        } else {
            Favorite fav = new Favorite();
            fav.setUserId(userId);
            fav.setArticleId(articleId);
            fav.setCreatedAt(OffsetDateTime.now());
            favoriteRepository.save(fav);
        }
    }

    /** 检查文章是否已被当前用户收藏。 */
    public boolean isFavorited(Long userId, Long articleId) {
        return favoriteRepository.existsByUserIdAndArticleId(userId, articleId);
    }

    /** 获取当前用户所有收藏。 */
    public List<Favorite> listFavorites(Long userId) {
        return favoriteRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    /** 统计用户文章总数。 */
    public long countByUser(Long userId) {
        return articleRepository.countByUserId(userId);
    }

    /** 统计用户今日采集文章数。 */
    public long countToday(Long userId) {
        return articleRepository.countByUserIdAndCollectedAtAfter(userId,
                OffsetDateTime.now().withHour(0).withMinute(0).withSecond(0).withNano(0));
    }

    /** 检查某篇内容是否已被采集过。 */
    public boolean existsByHash(Long userId, String hash) {
        return articleRepository.existsByUserIdAndSourceHash(userId, hash);
    }
}