package com.frontierscan.collection;

import com.frontierscan.article.Article;
import com.frontierscan.article.ArticleService;
import com.frontierscan.article.ArticleSummaryService;
import com.frontierscan.article.ArticleSummaryStatus;
import com.frontierscan.site.Site;
import com.frontierscan.collection.TagEvaluationAsyncService;
import com.frontierscan.site.SiteService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.time.OffsetDateTime;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 采集任务编排器。
 * <p>
 * 负责采集全流程的编排调度：
 * <ol>
 *   <li>接收采集请求（手动触发或定时调度）</li>
 *   <li>根据 Site 配置选择 Collector（RSS 优先 → HTML 降级）</li>
 *   <li>异步执行采集（通过 {@code @Async} 线程池）</li>
 *   <li>去重后批量保存文章到数据库</li>
 *   <li><b>并发调用 LLM 生成结构化摘要</b>（通过独立的 llmTaskExecutor 线程池）</li>
 *   <li>更新 CollectionRun 状态（COMPLETED / FAILED）</li>
 * </ol>
 *
 * <p><b>LLM 摘要并发说明：</b>
 * 采集保存完成后，通过 {@code llmTaskExecutor} 线程池并发调用 LLM API。
 * 最多 5 篇文章同时请求，100 个等待队列，超出后由调用线程执行。
 * 整体等待超时 10 分钟，单篇失败不影响其他文章的摘要处理。
 * LLM 未配置 API Key 时跳过摘要步骤（不报错）。</p>
 *
 * <p>线程安全：每个采集任务独立运行，互不干扰。</p>
 */
@Slf4j
@Service
public class CollectionOrchestrator {

    private final List<Collector> collectors;
    private final SiteService siteService;
    private final ArticleService articleService;
    private final ArticleSummaryService articleSummaryService;
    private final CollectionRunService collectionRunService;
    private final TagEvaluationAsyncService tagEvaluationAsyncService;

    /** LLM 调用专用线程池，与大模型 API 并发交互。 */
    private final Executor llmTaskExecutor;

    /** LLM 批量摘要的整体超时时间（分钟），超时后未完成的任务将被放弃。 */
    private static final int LLM_BATCH_TIMEOUT_MINUTES = 10;

    /**
     * 构造采集编排器。
     * <p>{@code LlmProvider} 未配置 API Key 时跳过摘要步骤。</p>
     *
     * @param llmTaskExecutor LLM 专用线程池，bean 名 {@code llmTaskExecutor}
     */
    public CollectionOrchestrator(List<Collector> collectors, SiteService siteService,
                                  ArticleService articleService, CollectionRunService collectionRunService,
                                  ArticleSummaryService articleSummaryService,
                                  TagEvaluationAsyncService tagEvaluationAsyncService,
                                  @Qualifier("llmTaskExecutor") Executor llmTaskExecutor) {
        this.collectors = collectors;
        this.siteService = siteService;
        this.articleService = articleService;
        this.articleSummaryService = articleSummaryService;
        this.collectionRunService = collectionRunService;
        this.tagEvaluationAsyncService = tagEvaluationAsyncService;
        this.llmTaskExecutor = llmTaskExecutor;
    }

    /**
     * 异步执行采集任务。
     * <p>在后台线程执行，返回后调用方可通过 runId 查询任务状态。</p>
     *
     * @param userId 当前用户 ID
     * @param siteId 目标网站 ID
     * @param runId  采集任务记录 ID
     * @return CompletableFuture，完成时携带 runId
     */
    @Async("collectionTaskExecutor")
    public CompletableFuture<Long> executeCollection(Long userId, Long siteId, Long runId) {
        log.info("Starting collection task: userId={}, siteId={}, runId={}", userId, siteId, runId);
        try {
            Site site = siteService.getById(userId, siteId);
            List<Article> saved = collectAndSaveWithFallback(userId, site);
            log.info("Saved {} new articles for site {}", saved.size(), site.getName());

            // 并发调用 LLM 生成结构化摘要；失败作为告警记录，不阻断采集成功状态。
            String warningMessage = summarizeArticlesConcurrently(saved);

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

    /**
     * 执行采集并保存文章，RSS 失败时自动降级 HTML。
     * <p>
     * 只有最终采集失败才向上抛出异常；如果 RSS 失败但 HTML 成功，则外层会按成功任务处理。
     * 采集器返回空候选文章视为 {@code EMPTY_RESULT} 失败，因为这代表系统无法从站点解析出可用内容；
     * 与“解析出候选文章但去重后新增 0 篇”的成功场景严格区分。
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
     * <p>
     * 采集器返回候选文章数量为 0 时抛出 {@link EmptyResultException}，
     * 让失败重试机制处理“无法解析出内容”的站点波动；若候选文章存在但去重后新增 0 篇，
     * 仍然视为一次成功采集。
     * </p>
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
     * 并发调用 LLM 为多篇文章生成摘要。
     * <p>
     * 通过 {@code llmTaskExecutor} 线程池并发提交，等全部完成后返回。
     * 最多 {@code llmTaskExecutor.maxPoolSize} (5) 篇文章同时请求 LLM API，
     * 整体超时 {@value LLM_BATCH_TIMEOUT_MINUTES} 分钟。
     * </p>
     *
     * <p><b>设计要点：</b>
     * <ul>
     *   <li>使用 {@link CompletableFuture#runAsync(Runnable, Executor)} 提交任务</li>
     *   <li>使用 {@link CompletableFuture#allOf(CompletableFuture[])} 等待全部完成</li>
     *   <li>使用 {@link CompletableFuture#orTimeout(long, TimeUnit)} 防止无限阻塞</li>
     *   <li>单篇异常不影响其他文章（异常在内部捕获）</li>
     * </ul>
     * </p>
     *
     * @param articles 已保存的文章列表
     */
    private String summarizeArticlesConcurrently(List<Article> articles) {
        if (articles == null || articles.isEmpty()) {
            return null;
        }
        log.info("Concurrently summarizing {} articles via LLM (pool={}, maxConcurrency={})",
                articles.size(), "llmTaskExecutor", 5);

        AtomicInteger failureCount = new AtomicInteger();

        // 提交所有 LLM 调用任务到线程池
        List<CompletableFuture<Void>> futures = articles.stream()
                .map(article -> CompletableFuture.runAsync(() -> {
                    try {
                        Article summarized = articleSummaryService.summarizeCollectedArticle(article.getId());
                        if (summarized == null || ArticleSummaryStatus.FAILED.equals(summarized.getSummaryStatus())) {
                            failureCount.incrementAndGet();
                            log.warn("LLM summarization produced FAILED status for article {}", article.getId());
                        } else {
                            log.debug("LLM summary governance completed for article {}: status={}",
                                    article.getId(), summarized.getSummaryStatus());
                        }
                    } catch (Exception e) {
                        failureCount.incrementAndGet();
                        log.warn("LLM summarization failed for article {} ({}): {}",
                                article.getId(), article.getTitle(), e.getMessage());
                    }
                }, llmTaskExecutor))
                .toList();

        // 等待全部完成（带超时）
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                .orTimeout(LLM_BATCH_TIMEOUT_MINUTES, TimeUnit.MINUTES)
                .exceptionally(ex -> {
                    failureCount.incrementAndGet();
                    log.warn("LLM batch summarization partially timed out after {} min: {}",
                            LLM_BATCH_TIMEOUT_MINUTES, ex.getMessage());
                    return null;
                })
                .join();

        log.info("LLM batch summarization complete for {} articles", articles.size());
        if (failureCount.get() > 0) {
            return CollectionFailureClassifier.LLM_SUMMARY_FAILED
                    + ": " + failureCount.get() + " 篇文章摘要生成失败";
        }
        return null;
    }

    /**
     * 根据 Site 配置选择合适的 Collector。
     * <p>策略：有 RSS 地址 → RssCollector；无 RSS 地址 → HtmlCollector。</p>
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
