package com.frontierscan.collection;

import com.frontierscan.article.Article;
import com.frontierscan.article.ArticleService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/**
 * 标签评估异步服务。
 * <p>
 * 在采集完成之后，异步调用 {@link com.frontierscan.llm.tag.TagEvaluationAgent}
 * 对新入库的文章进行标签评分。使用独立的线程池执行，避免阻塞采集主流程。
 * </p>
 *
 * <p>与 LLM 摘要共享同一个 {@code llmTaskExecutor} 线程池，因为标签评估和摘要
 * 是串行执行而非并行（摘要完毕后才开始评估），不会竞争线程资源。</p>
 */
@Slf4j
@Service
public class TagEvaluationAsyncService {

    private final ArticleService articleService;
    private final Executor llmTaskExecutor;

    /** 批量标签评估的整体超时时间（分钟）。 */
    private static final int TAG_BATCH_TIMEOUT_MINUTES = 5;

    public TagEvaluationAsyncService(ArticleService articleService,
                                     @Qualifier("llmTaskExecutor") Executor llmTaskExecutor) {
        this.articleService = articleService;
        this.llmTaskExecutor = llmTaskExecutor;
    }

    /**
     * 并发对多篇文章执行标签评估。
     * <p>
     * 每篇文章提交一个独立任务到线程池，全部完成后返回。
     * 单篇评估异常不影响其他文章。
     * </p>
     *
     * @param articles 已入库的文章列表
     */
    public void evaluateArticlesConcurrently(List<Article> articles) {
        if (articles == null || articles.isEmpty()) {
            return;
        }
        log.info("Concurrently evaluating tags for {} articles", articles.size());

        List<CompletableFuture<Void>> futures = articles.stream()
                .map(article -> CompletableFuture.runAsync(() -> {
                    try {
                        articleService.evaluateArticleTags(
                                article.getId(),
                                article.getTitle(),
                                article.getContentExcerpt());
                    } catch (Exception e) {
                        log.warn("Tag evaluation failed for article {} ({}): {}",
                                article.getId(), article.getTitle(), e.getMessage());
                    }
                }, llmTaskExecutor))
                .toList();

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                .orTimeout(TAG_BATCH_TIMEOUT_MINUTES, TimeUnit.MINUTES)
                .exceptionally(ex -> {
                    log.warn("Tag batch evaluation partially timed out after {} min: {}",
                            TAG_BATCH_TIMEOUT_MINUTES, ex.getMessage());
                    return null;
                })
                .join();

        log.info("Tag batch evaluation complete for {} articles", articles.size());
    }
}
