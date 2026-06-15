package com.frontierscan.collection;

import com.frontierscan.article.Article;
import com.frontierscan.article.ArticleService;
import com.frontierscan.article.ArticleSummaryService;
import com.frontierscan.article.ArticleSummaryStatus;
import com.frontierscan.site.Site;
import com.frontierscan.site.SiteService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 采集任务编排器。
 * <p>
 * 负责站点采集、文章去重落库、摘要治理、标签评估和任务状态回写。采集任务本身运行在
 * {@code frontierScanCollectionExecutor}，采集完成后的增强链路使用“单篇文章摘要完成后立即触发标签评估”的流水线模型：
 * 摘要并发使用 {@code frontierScanLlmSummaryExecutor}，标签并发由 {@link TagEvaluationAsyncService}
 * 下沉到 {@code frontierScanLlmTagExecutor}。这样既保留任务最终等待增强结果的业务语义，又减少批次阶段之间的空等时间。
 * </p>
 */
@Slf4j
@Service
public class CollectionOrchestrator {

    private static final int ENHANCEMENT_BATCH_TIMEOUT_MINUTES = 10;

    private final List<Collector> collectors;
    private final SiteService siteService;
    private final ArticleService articleService;
    private final ArticleSummaryService articleSummaryService;
    private final CollectionRunService collectionRunService;
    private final TagEvaluationAsyncService tagEvaluationAsyncService;
    private final Executor summaryExecutor;

    public CollectionOrchestrator(List<Collector> collectors,
                                  SiteService siteService,
                                  ArticleService articleService,
                                  CollectionRunService collectionRunService,
                                  ArticleSummaryService articleSummaryService,
                                  TagEvaluationAsyncService tagEvaluationAsyncService,
                                  @Qualifier("frontierScanLlmSummaryExecutor") Executor summaryExecutor) {
        this.collectors = collectors;
        this.siteService = siteService;
        this.articleService = articleService;
        this.collectionRunService = collectionRunService;
        this.articleSummaryService = articleSummaryService;
        this.tagEvaluationAsyncService = tagEvaluationAsyncService;
        this.summaryExecutor = summaryExecutor;
    }

    /**
     * 异步执行采集任务。
     * <p>站点归属校验由 {@link SiteService#getById(Long, Long)} 完成，确保用户只能采集自己的站点。</p>
     */
    @Async("frontierScanCollectionExecutor")
    public CompletableFuture<Long> executeCollection(Long userId, Long siteId, Long runId) {
        log.info("Starting collection task: userId={}, siteId={}, runId={}", userId, siteId, runId);
        try {
            Site site = siteService.getById(userId, siteId);
            List<Article> saved = collectAndSaveWithFallback(userId, site);
            log.info("Saved {} new articles for site {}", saved.size(), site.getName());

            String warningMessage = enhanceArticlesConcurrently(saved);

            siteService.recordSuccess(siteId);
            collectionRunService.complete(runId, saved.size(), warningMessage);
            return CompletableFuture.completedFuture(runId);
        } catch (CollectorException e) {
            log.warn("Collection failed: {} (source={}, site={})", e.getMessage(), e.getSourceType(), e.getSiteUrl());
            String failureType = CollectionFailureClassifier.failureType(e);
            String failureStage = CollectionFailureClassifier.failureStage(e);
            OffsetDateTime nextRetryAt = collectionRunService.fail(runId, failureType, failureStage, e.getMessage());
            siteService.recordFailure(siteId, e.getMessage(), nextRetryAt);
            return CompletableFuture.failedFuture(e);
        } catch (Exception e) {
            log.error("Unexpected error during collection: {}", e.getMessage(), e);
            String message = "Unexpected error: " + e.getMessage();
            OffsetDateTime nextRetryAt = collectionRunService.fail(
                    runId,
                    CollectionFailureClassifier.UNKNOWN,
                    CollectionFailureClassifier.STAGE_UNKNOWN,
                    message);
            siteService.recordFailure(siteId, message, nextRetryAt);
            return CompletableFuture.failedFuture(e);
        }
    }

    /** 合并非阻断增强步骤产生的告警，供任务记录页统一展示。 */
    private static String combineWarnings(String... warnings) {
        List<String> validWarnings = Arrays.stream(warnings)
                .filter(warning -> warning != null && !warning.isBlank())
                .toList();
        return validWarnings.isEmpty() ? null : String.join("; ", validWarnings);
    }

    /**
     * 执行采集并保存文章，RSS 失败时自动降级 HTML。
     * <p>
     * 只有最终采集失败才向上抛出异常；若 RSS 失败但 HTML 成功，则外层按成功任务处理。
     * 采集器无法解析出任何候选文章时视为 {@code EMPTY_RESULT}，与候选文章存在但去重后新增 0 篇严格区分。
     * </p>
     */
    private List<Article> collectAndSaveWithFallback(Long userId, Site site) {
        Collector collector = resolveCollector(site);
        log.info("Resolved collector: {} for site: {}", collector.sourceType(), site.getName());
        try {
            return collectAndSave(userId, site, collector);
        } catch (CollectorException primaryEx) {
            if (!CollectionFailureClassifier.STAGE_RSS.equals(primaryEx.getSourceType())) {
                throw primaryEx;
            }
            log.info("RSS collection failed for site {}, attempting HTML fallback...", site.getId());
            Collector htmlCollector = findCollector(CollectionFailureClassifier.STAGE_HTML);
            if (htmlCollector == null) {
                throw primaryEx;
            }
            try {
                return collectAndSave(userId, site, htmlCollector);
            } catch (CollectorException fallbackEx) {
                String message = "RSS失败: " + primaryEx.getMessage()
                        + "；HTML降级失败: " + fallbackEx.getMessage();
                throw new CollectorException(
                        fallbackEx.getSourceType(),
                        fallbackEx.getSiteUrl(),
                        fallbackEx.getErrorCode(),
                        message,
                        fallbackEx);
            }
        }
    }

    /**
     * 执行单个采集器并将候选文章去重落库。
     * <p>候选文章为空说明解析器无法从站点识别内容，需要进入失败重试；去重后新增 0 篇仍视为采集成功。</p>
     */
    private List<Article> collectAndSave(Long userId, Site site, Collector collector) {
        CollectResult result = collector.collect(site);
        if (result.rawArticles() == null || result.rawArticles().isEmpty()) {
            throw new EmptyResultException(
                    collector.sourceType(),
                    CollectionFailureClassifier.STAGE_RSS.equals(collector.sourceType())
                            ? site.getRssUrl() : site.getUrl(),
                    collector.sourceType() + " 未解析到可采集文章");
        }
        return articleService.batchSaveArticles(userId, site.getId(), site.getCategoryId(), result.rawArticles());
    }

    /**
     * 并发执行采集后的文章增强流水线。
     * <p>
     * 每篇文章先在摘要线程池中执行摘要治理；摘要尝试结束后，不论状态是 COMPLETED、LOW_QUALITY 还是 FAILED，
     * 都继续触发标签评估，使标签仍可基于摘要、要点或正文兜底完成计算。单篇失败只累计告警，不提升为采集失败。
     * </p>
     */
    private String enhanceArticlesConcurrently(List<Article> articles) {
        if (articles == null || articles.isEmpty()) {
            return null;
        }
        log.info("Concurrently enhancing {} articles via summary/tag pipeline", articles.size());

        AtomicInteger summaryFailureCount = new AtomicInteger();
        AtomicInteger tagFailureCount = new AtomicInteger();
        List<CompletableFuture<Void>> futures = articles.stream()
                .map(article -> CompletableFuture
                        .supplyAsync(() -> summarizeArticle(article, summaryFailureCount), summaryExecutor)
                        .thenCompose(ignored -> tagEvaluationAsyncService.evaluateArticleAsync(article))
                        .thenAccept(tagSuccess -> {
                            if (!tagSuccess) {
                                tagFailureCount.incrementAndGet();
                            }
                        })
                        .exceptionally(ex -> {
                            tagFailureCount.incrementAndGet();
                            log.warn("Article enhancement pipeline failed for article {}: {}",
                                    article.getId(), ex.getMessage());
                            return null;
                        }))
                .toList();

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                .orTimeout(ENHANCEMENT_BATCH_TIMEOUT_MINUTES, TimeUnit.MINUTES)
                .exceptionally(ex -> {
                    summaryFailureCount.incrementAndGet();
                    log.warn("Article enhancement batch partially timed out after {} min: {}",
                            ENHANCEMENT_BATCH_TIMEOUT_MINUTES, ex.getMessage());
                    return null;
                })
                .join();

        log.info("Article enhancement pipeline complete for {} articles", articles.size());
        return combineWarnings(
                buildWarning(CollectionFailureClassifier.LLM_SUMMARY_FAILED,
                        summaryFailureCount.get(), "篇文章摘要生成失败"),
                buildWarning(CollectionFailureClassifier.TAG_EVALUATION_FAILED,
                        tagFailureCount.get(), "篇文章标签评估失败"));
    }

    private Article summarizeArticle(Article article, AtomicInteger summaryFailureCount) {
        try {
            Article summarized = articleSummaryService.summarizeCollectedArticle(article.getId());
            if (summarized == null || ArticleSummaryStatus.FAILED.equals(summarized.getSummaryStatus())) {
                summaryFailureCount.incrementAndGet();
                log.warn("LLM summarization produced FAILED status for article {}", article.getId());
            } else {
                log.debug("LLM summary governance completed for article {}: status={}",
                        article.getId(), summarized.getSummaryStatus());
            }
            return summarized;
        } catch (Exception e) {
            summaryFailureCount.incrementAndGet();
            log.warn("LLM summarization failed for article {} ({}): {}",
                    article.getId(), article.getTitle(), e.getMessage());
            return article;
        }
    }

    private static String buildWarning(String failureType, int count, String message) {
        return count <= 0 ? null : failureType + ": " + count + " " + message;
    }

    /**
     * 根据 Site 配置选择合适采集器。
     * <p>策略：有 RSS 地址优先 RssCollector；无 RSS 地址使用 HtmlCollector。</p>
     */
    private Collector resolveCollector(Site site) {
        String type = (site.getRssUrl() != null && !site.getRssUrl().isBlank()) ? "RSS" : "HTML";
        Collector collector = findCollector(type);
        if (collector == null) {
            throw new IllegalStateException("No collector found for type: " + type);
        }
        return collector;
    }

    /** 按类型查找已注册的 Collector。 */
    private Collector findCollector(String sourceType) {
        return collectors.stream()
                .filter(c -> c.sourceType().equals(sourceType))
                .findFirst()
                .orElse(null);
    }
}
