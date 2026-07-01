package com.frontierscan.article;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 摘要滞留恢复器。
 * <p>
 * 采集流程会先保存文章，再通过批量增强链路生成摘要。如果应用在增强链路中途重启、批次超时，
 * 或外部 LLM 调用造成线程长期阻塞，部分文章会停留在 {@code PENDING + 无 summary}，前端只能显示
 * “重新生成摘要”。本恢复器定期扫描这些滞留文章并按自动摘要链路重新处理，使系统最终收敛。
 * </p>
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "app.summary-recovery", name = "enabled", havingValue = "true", matchIfMissing = true)
public class ArticleSummaryRecoveryScheduler {

    private final ArticleRepository articleRepository;
    private final ArticleSummaryService articleSummaryService;
    private final ArticleService articleService;
    private final ArticleSummaryRecoveryProperties properties;

    public ArticleSummaryRecoveryScheduler(ArticleRepository articleRepository,
                                           ArticleSummaryService articleSummaryService,
                                           ArticleService articleService,
                                           ArticleSummaryRecoveryProperties properties) {
        this.articleRepository = articleRepository;
        this.articleSummaryService = articleSummaryService;
        this.articleService = articleService;
        this.properties = properties;
    }

    /**
     * 恢复滞留的 PENDING 摘要。
     * <p>使用 fixedDelay 确保上一轮恢复结束后再开始下一轮，避免同一实例内重叠执行。</p>
     */
    @Scheduled(
            initialDelayString = "${app.summary-recovery.fixed-delay-ms:300000}",
            fixedDelayString = "${app.summary-recovery.fixed-delay-ms:300000}"
    )
    public void recoverStalePendingSummaries() {
        if (!properties.enabledValue()) {
            return;
        }

        OffsetDateTime staleBefore = OffsetDateTime.now().minusMinutes(properties.staleAfterMinutesValue());
        List<Article> staleArticles = articleRepository.findStalePendingSummaries(
                ArticleSummaryStatus.PENDING,
                staleBefore,
                staleBefore,
                PageRequest.of(0, properties.batchSizeValue()));
        if (staleArticles.isEmpty()) {
            return;
        }

        log.info("Recovering {} stale PENDING article summaries", staleArticles.size());
        for (Article article : staleArticles) {
            recoverOne(article);
        }
    }

    private void recoverOne(Article article) {
        try {
            Article summarized = articleSummaryService.summarizeCollectedArticle(article.getId());
            if (summarized == null) {
                log.warn("Summary recovery skipped missing article {}", article.getId());
                return;
            }
            if (!ArticleSummaryStatus.FAILED.equals(summarized.getSummaryStatus())) {
                articleService.evaluateArticleTags(summarized.getId());
            }
        } catch (Exception e) {
            log.warn("Summary recovery failed for article {}: {}", article.getId(), e.getMessage());
        }
    }
}
