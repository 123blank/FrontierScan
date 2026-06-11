package com.frontierscan.collection;

import com.frontierscan.article.Article;
import com.frontierscan.article.ArticleService;
import com.frontierscan.site.Site;
import com.frontierscan.site.SiteService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * 采集任务编排器。
 * <p>
 * 负责采集全流程的编排调度：
 * <ol>
 *   <li>接收采集请求（手动触发或定时调度）</li>
 *   <li>根据 Site 配置选择 Collector（RSS 优先 → HTML 降级）</li>
 *   <li>异步执行采集（通过 {@code @Async} 线程池）</li>
 *   <li>去重后批量保存文章到数据库</li>
 *   <li>更新 CollectionRun 状态</li>
 *   <li>触发 LLM 摘要处理（后续迭代）</li>
 * </ol>
 * 线程安全：每个采集任务独立运行，互不干扰。
 * </p>
 */
@Slf4j
@Service
public class CollectionOrchestrator {

    private final List<Collector> collectors;
    private final SiteService siteService;
    private final ArticleService articleService;
    private final CollectionRunService collectionRunService;

    public CollectionOrchestrator(List<Collector> collectors, SiteService siteService,
                                  ArticleService articleService, CollectionRunService collectionRunService) {
        this.collectors = collectors;
        this.siteService = siteService;
        this.articleService = articleService;
        this.collectionRunService = collectionRunService;
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
            Site site = siteService.getById(siteId);
            Collector collector = resolveCollector(site);
            log.info("Resolved collector: {} for site: {}", collector.sourceType(), site.getName());
            CollectResult result = collector.collect(site);

            // 去重后保存
            List<Article> saved = articleService.batchSaveArticles(userId, siteId,
                    site.getCategoryId(), result.rawArticles());
            log.info("Collection completed: saved {} new articles for site {}", saved.size(), site.getName());

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
                    Site site = siteService.getById(siteId);
                    Collector htmlCollector = findCollector("HTML");
                    if (htmlCollector != null) {
                        CollectResult result = htmlCollector.collect(site);
                        List<Article> saved = articleService.batchSaveArticles(
                                userId, siteId, site.getCategoryId(), result.rawArticles());
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