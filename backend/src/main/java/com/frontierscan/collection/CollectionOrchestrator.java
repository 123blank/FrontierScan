package com.frontierscan.collection;

import com.frontierscan.article.Article;
import com.frontierscan.article.ArticleService;
import com.frontierscan.llm.LlmProvider;
import com.frontierscan.llm.SummaryRequest;
import com.frontierscan.llm.SummaryResult;
import com.frontierscan.site.Site;
import com.frontierscan.site.SiteService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

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
    private final CollectionRunService collectionRunService;
    private final LlmProvider llmProvider;

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
                                  LlmProvider llmProvider,
                                  @Qualifier("llmTaskExecutor") Executor llmTaskExecutor) {
        this.collectors = collectors;
        this.siteService = siteService;
        this.articleService = articleService;
        this.collectionRunService = collectionRunService;
        this.llmProvider = llmProvider;
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
            Collector collector = resolveCollector(site);
            log.info("Resolved collector: {} for site: {}", collector.sourceType(), site.getName());
            CollectResult result = collector.collect(site);

            // 去重后批量保存文章
            List<Article> saved = articleService.batchSaveArticles(userId, siteId,
                    site.getCategoryId(), result.rawArticles());
            log.info("Saved {} new articles for site {}", saved.size(), site.getName());

            // 并发调用 LLM 生成结构化摘要
            summarizeArticlesConcurrently(saved);

            collectionRunService.complete(runId, saved.size());
            return CompletableFuture.completedFuture(runId);

        } catch (EmptyResultException e) {
            log.info("Collection returned no new content: {}", e.getMessage());
            collectionRunService.complete(runId, 0);
            return CompletableFuture.completedFuture(runId);

        } catch (CollectorException e) {
            log.warn("Collection failed: {} (source={}, site={})", e.getMessage(), e.getSourceType(), e.getSiteUrl());
            // RSS 失败 → 自动降级 HTML
            if ("RSS".equals(e.getSourceType())) {
                log.info("Attempting fallback to HTML collector...");
                try {
                    Site site = siteService.getById(userId, siteId);
                    Collector htmlCollector = findCollector("HTML");
                    if (htmlCollector != null) {
                        CollectResult result = htmlCollector.collect(site);
                        List<Article> saved = articleService.batchSaveArticles(
                                userId, siteId, site.getCategoryId(), result.rawArticles());
                        // 降级成功后的文章也进行 LLM 摘要
                        summarizeArticlesConcurrently(saved);
                        collectionRunService.complete(runId, saved.size());
                        return CompletableFuture.completedFuture(runId);
                    }
                } catch (CollectorException fallbackEx) {
                    collectionRunService.fail(runId, "RSS失败且HTML降级也失败: " + fallbackEx.getMessage());
                    return CompletableFuture.failedFuture(fallbackEx);
                }
            }
            collectionRunService.fail(runId, e.getMessage());
            return CompletableFuture.failedFuture(e);

        } catch (Exception e) {
            log.error("Unexpected error during collection: {}", e.getMessage(), e);
            collectionRunService.fail(runId, "Unexpected error: " + e.getMessage());
            return CompletableFuture.failedFuture(e);
        }
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
    private void summarizeArticlesConcurrently(List<Article> articles) {
        if (articles == null || articles.isEmpty()) {
            return;
        }
        log.info("Concurrently summarizing {} articles via LLM (pool={}, maxConcurrency={})",
                articles.size(), "llmTaskExecutor", 5);

        // 提交所有 LLM 调用任务到线程池
        List<CompletableFuture<Void>> futures = articles.stream()
                .map(article -> CompletableFuture.runAsync(() -> {
                    try {
                        SummaryResult summary = llmProvider.summarize(new SummaryRequest(
                                article.getTitle(),
                                article.getSourceUrl(),
                                article.getContentExcerpt()));
                        if (summary != null) {
                            articleService.updateLlmSummary(article.getId(), summary);
                            log.debug("LLM summary updated for article {}: {}",
                                    article.getId(), article.getTitle());
                        }
                    } catch (Exception e) {
                        log.warn("LLM summarization failed for article {} ({}): {}",
                                article.getId(), article.getTitle(), e.getMessage());
                    }
                }, llmTaskExecutor))
                .toList();

        // 等待全部完成（带超时）
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                .orTimeout(LLM_BATCH_TIMEOUT_MINUTES, TimeUnit.MINUTES)
                .exceptionally(ex -> {
                    log.warn("LLM batch summarization partially timed out after {} min: {}",
                            LLM_BATCH_TIMEOUT_MINUTES, ex.getMessage());
                    return null;
                })
                .join();

        log.info("LLM batch summarization complete for {} articles", articles.size());
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
