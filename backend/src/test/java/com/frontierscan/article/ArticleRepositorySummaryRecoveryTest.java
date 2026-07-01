package com.frontierscan.article;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import java.time.OffsetDateTime;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 摘要恢复查询 Repository 测试。
 */
@SpringBootTest
@ActiveProfiles("test")
@DisplayName("ArticleRepository 摘要恢复查询")
class ArticleRepositorySummaryRecoveryTest {

    @Autowired
    private ArticleRepository articleRepository;

    @Test
    @DisplayName("只查询滞留 PENDING 且无摘要的文章")
    void shouldFindOnlyStalePendingArticlesWithoutSummary() {
        OffsetDateTime now = OffsetDateTime.now();
        Article stalePending = article(1L, "stale", ArticleSummaryStatus.PENDING, null,
                null, now.minusHours(2));
        Article freshPending = article(2L, "fresh", ArticleSummaryStatus.PENDING, null,
                null, now.minusMinutes(2));
        Article attemptedRecently = article(3L, "attempted", ArticleSummaryStatus.PENDING, null,
                now.minusMinutes(2), now.minusHours(2));
        Article alreadyHasSummary = article(4L, "summarized", ArticleSummaryStatus.PENDING, "已有摘要",
                null, now.minusHours(2));
        Article failed = article(5L, "failed", ArticleSummaryStatus.FAILED, null,
                null, now.minusHours(2));
        articleRepository.saveAll(List.of(
                stalePending,
                freshPending,
                attemptedRecently,
                alreadyHasSummary,
                failed));

        List<Article> result = articleRepository.findStalePendingSummaries(
                ArticleSummaryStatus.PENDING,
                now.minusMinutes(10),
                now.minusMinutes(10),
                PageRequest.of(0, 10));

        assertThat(result).extracting(Article::getSourceHash).containsExactly("stale");
    }

    private static Article article(Long id, String sourceHash, String status, String summary,
                                   OffsetDateTime lastAttemptAt, OffsetDateTime collectedAt) {
        Article article = new Article();
        article.setUserId(id);
        article.setSiteId(1L);
        article.setCategoryId(1L);
        article.setTitle("测试文章 " + id);
        article.setSourceUrl("https://example.com/" + id);
        article.setSourceHash(sourceHash);
        article.setContentExcerpt("这是一段足够生成摘要的正文内容。");
        article.setSummary(summary);
        article.setSummaryStatus(status);
        article.setSummaryRetryCount(0);
        article.setSummaryLastAttemptAt(lastAttemptAt);
        article.setCollectedAt(collectedAt);
        article.setCreatedAt(collectedAt);
        return article;
    }
}
