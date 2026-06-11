package com.frontierscan.article;

import com.frontierscan.collection.CollectResult;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 文章管理业务服务。
 * <p>
 * 提供文章的多维度分页查询、批量落库、收藏管理和统计功能。
 * 所有操作强制绑定 userId，确保用户只能访问自己的数据。
 * 批量保存方法已标记 {@code @Transactional} 保证原子性。
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

    /** 分页查询文章列表，支持按分类和来源网站筛选。 */
    public Page<Article> listByUser(Long userId, Long categoryId, Long siteId, Pageable pageable) {
        if (categoryId != null) {
            return articleRepository.findByUserIdAndCategoryIdOrderByCollectedAtDesc(userId, categoryId, pageable);
        }
        if (siteId != null) {
            return articleRepository.findByUserIdAndSiteIdOrderByCollectedAtDesc(userId, siteId, pageable);
        }
        return articleRepository.findByUserIdOrderByCollectedAtDesc(userId, pageable);
    }

    /** 获取文章详情，同时校验用户权限。 */
    public Article getById(Long userId, Long id) {
        Article article = articleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("文章不存在"));
        if (!article.getUserId().equals(userId)) {
            throw new RuntimeException("无权访问该文章");
        }
        return article;
    }

    /**
     * 批量去重并保存采集到的文章。
     * <p>
     * 根据 sourceHash 过滤数据库中已有的内容，只保存新文章。
     * 使用 {@code @Transactional} 保证批量操作的原子性。
     * </p>
     *
     * @param userId        当前用户 ID
     * @param siteId        来源网站 ID
     * @param categoryId    所属分类 ID
     * @param rawArticles   原始文章列表（采集器输出）
     * @return 实际新增保存的文章列表
     */
    @Transactional
    public List<Article> batchSaveArticles(Long userId, Long siteId, Long categoryId,
                                           List<CollectResult.RawArticle> rawArticles) {
        List<Article> newArticles = rawArticles.stream()
                .filter(raw -> !articleRepository.existsByUserIdAndSourceHash(userId, raw.sourceHash()))
                .map(raw -> {
                    Article article = new Article();
                    article.setUserId(userId);
                    article.setSiteId(siteId);
                    article.setCategoryId(categoryId);
                    article.setTitle(raw.title());
                    article.setSourceUrl(raw.sourceUrl());
                    article.setContentExcerpt(raw.contentExcerpt());
                    article.setSourceHash(raw.sourceHash());
                    article.setPublishedAt(raw.publishedAt() != null
                            ? raw.publishedAt().atOffset(OffsetDateTime.now().getOffset())
                            : null);
                    article.setCollectedAt(OffsetDateTime.now());
                    article.setCreatedAt(OffsetDateTime.now());
                    return article;
                })
                .toList();

        if (newArticles.isEmpty()) {
            return List.of();
        }
        return articleRepository.saveAll(newArticles);
    }

    /** 切换收藏状态。 */
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

    /** 检查文章是否已被收藏。 */
    public boolean isFavorited(Long userId, Long articleId) {
        return favoriteRepository.existsByUserIdAndArticleId(userId, articleId);
    }

    /** 获取收藏列表。 */
    public List<Favorite> listFavorites(Long userId) {
        return favoriteRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    /** 统计文章总数。 */
    public long countByUser(Long userId) {
        return articleRepository.countByUserId(userId);
    }

    /** 统计今日采集数。 */
    public long countToday(Long userId) {
        return articleRepository.countByUserIdAndCollectedAtAfter(userId,
                OffsetDateTime.now().withHour(0).withMinute(0).withSecond(0).withNano(0));
    }

    /** 检查 sourceHash 是否已存在。 */
    public boolean existsByHash(Long userId, String hash) {
        return articleRepository.existsByUserIdAndSourceHash(userId, hash);
    }
}