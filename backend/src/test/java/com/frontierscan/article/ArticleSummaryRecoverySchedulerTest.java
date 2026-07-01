package com.frontierscan.article;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;
import java.time.OffsetDateTime;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link ArticleSummaryRecoveryScheduler} 摘要滞留恢复测试。
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("ArticleSummaryRecoveryScheduler 摘要恢复")
class ArticleSummaryRecoverySchedulerTest {

    @Mock
    private ArticleRepository articleRepository;
    @Mock
    private ArticleSummaryService articleSummaryService;
    @Mock
    private ArticleService articleService;

    private ArticleSummaryRecoveryScheduler scheduler;

    @BeforeEach
    void setUp() {
        scheduler = new ArticleSummaryRecoveryScheduler(
                articleRepository,
                articleSummaryService,
                articleService,
                new ArticleSummaryRecoveryProperties(true, 300_000, 15, 7));
    }

    @Test
    @DisplayName("扫描滞留 PENDING 文章并重新生成摘要")
    void shouldRecoverStalePendingSummaries() {
        Article stale = article(100L);
        Article summarized = article(100L);
        summarized.setSummaryStatus(ArticleSummaryStatus.COMPLETED);
        summarized.setSummary("恢复后的摘要内容");

        when(articleRepository.findStalePendingSummaries(
                eq(ArticleSummaryStatus.PENDING), any(), any(), any(Pageable.class)))
                .thenReturn(List.of(stale));
        when(articleSummaryService.summarizeCollectedArticle(100L)).thenReturn(summarized);

        scheduler.recoverStalePendingSummaries();

        verify(articleSummaryService).summarizeCollectedArticle(100L);
        verify(articleService).evaluateArticleTags(100L);

        ArgumentCaptor<Pageable> pageableCaptor = ArgumentCaptor.forClass(Pageable.class);
        verify(articleRepository).findStalePendingSummaries(
                eq(ArticleSummaryStatus.PENDING), any(), any(), pageableCaptor.capture());
        assertThat(pageableCaptor.getValue().getPageSize()).isEqualTo(7);
    }

    @Test
    @DisplayName("摘要仍失败时不触发标签评估")
    void shouldNotEvaluateTagsWhenRecoveryFails() {
        Article stale = article(200L);
        Article failed = article(200L);
        failed.setSummaryStatus(ArticleSummaryStatus.FAILED);

        when(articleRepository.findStalePendingSummaries(
                eq(ArticleSummaryStatus.PENDING), any(), any(), any(Pageable.class)))
                .thenReturn(List.of(stale));
        when(articleSummaryService.summarizeCollectedArticle(200L)).thenReturn(failed);

        scheduler.recoverStalePendingSummaries();

        verify(articleSummaryService).summarizeCollectedArticle(200L);
        verify(articleService, never()).evaluateArticleTags(any());
    }

    @Test
    @DisplayName("关闭恢复器时不扫描数据库")
    void shouldSkipWhenDisabled() {
        ArticleSummaryRecoveryScheduler disabledScheduler = new ArticleSummaryRecoveryScheduler(
                articleRepository,
                articleSummaryService,
                articleService,
                new ArticleSummaryRecoveryProperties(false, 300_000, 15, 7));

        disabledScheduler.recoverStalePendingSummaries();

        verify(articleRepository, never()).findStalePendingSummaries(any(), any(), any(), any());
        verify(articleSummaryService, never()).summarizeCollectedArticle(any());
    }

    private static Article article(Long id) {
        Article article = new Article();
        article.setId(id);
        article.setUserId(1L);
        article.setSiteId(1L);
        article.setCategoryId(1L);
        article.setTitle("测试文章");
        article.setSourceUrl("https://example.com/" + id);
        article.setSourceHash("hash-" + id);
        article.setContentExcerpt("这是一段足够生成摘要的正文内容。");
        article.setSummaryStatus(ArticleSummaryStatus.PENDING);
        article.setSummaryRetryCount(0);
        article.setCollectedAt(OffsetDateTime.now().minusHours(1));
        article.setCreatedAt(OffsetDateTime.now().minusHours(1));
        return article;
    }
}
