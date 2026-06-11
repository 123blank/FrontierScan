package com.frontierscan.article;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ArticleRepository extends JpaRepository<Article, Long> {
    Page<Article> findByUserIdOrderByCollectedAtDesc(Long userId, Pageable pageable);
    Page<Article> findByUserIdAndCategoryIdOrderByCollectedAtDesc(Long userId, Long categoryId, Pageable pageable);
    Page<Article> findByUserIdAndSiteIdOrderByCollectedAtDesc(Long userId, Long siteId, Pageable pageable);
    List<Article> findByUserIdAndSourceHash(Long userId, String sourceHash);
    boolean existsByUserIdAndSourceHash(Long userId, String sourceHash);
    long countByUserId(Long userId);
    long countByUserIdAndCollectedAtAfter(Long userId, java.time.OffsetDateTime after);
}
