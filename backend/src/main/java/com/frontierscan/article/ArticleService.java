package com.frontierscan.article;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.List;

@Service
public class ArticleService {

    private final ArticleRepository articleRepository;
    private final FavoriteRepository favoriteRepository;

    public ArticleService(ArticleRepository articleRepository, FavoriteRepository favoriteRepository) {
        this.articleRepository = articleRepository;
        this.favoriteRepository = favoriteRepository;
    }

    public Page<Article> listByUser(Long userId, Long categoryId, Long siteId, Pageable pageable) {
        if (categoryId != null) {
            return articleRepository.findByUserIdAndCategoryIdOrderByCollectedAtDesc(userId, categoryId, pageable);
        }
        if (siteId != null) {
            return articleRepository.findByUserIdAndSiteIdOrderByCollectedAtDesc(userId, siteId, pageable);
        }
        return articleRepository.findByUserIdOrderByCollectedAtDesc(userId, pageable);
    }

    public Article getById(Long userId, Long id) {
        Article article = articleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("文章不存在"));
        if (!article.getUserId().equals(userId)) {
            throw new RuntimeException("无权访问该文章");
        }
        return article;
    }

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

    public boolean isFavorited(Long userId, Long articleId) {
        return favoriteRepository.existsByUserIdAndArticleId(userId, articleId);
    }

    public List<Favorite> listFavorites(Long userId) {
        return favoriteRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    public long countByUser(Long userId) {
        return articleRepository.countByUserId(userId);
    }

    public long countToday(Long userId) {
        return articleRepository.countByUserIdAndCollectedAtAfter(userId, OffsetDateTime.now().withHour(0).withMinute(0).withSecond(0).withNano(0));
    }

    public boolean existsByHash(Long userId, String hash) {
        return articleRepository.existsByUserIdAndSourceHash(userId, hash);
    }
}
