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
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 标签评估异步服务。
 * <p>
 * 采集链路在文章落库和摘要治理完成后调用本服务。标签评估依赖 LLM 分类和打分，属于非阻断增强能力：
 * 单篇文章失败只累计告警，不影响采集任务完成，也不增加站点连续失败次数。
 * </p>
 */
@Slf4j
@Service
public class TagEvaluationAsyncService {

    private static final int TAG_BATCH_TIMEOUT_MINUTES = 5;

    private final ArticleService articleService;
    private final Executor llmTaskExecutor;

    public TagEvaluationAsyncService(ArticleService articleService,
                                     @Qualifier("llmTaskExecutor") Executor llmTaskExecutor) {
        this.articleService = articleService;
        this.llmTaskExecutor = llmTaskExecutor;
    }

    /**
     * 并发评估一批新文章标签，并返回可写入任务记录的告警文案。
     * <p>
     * 每个任务只传递文章 ID，真正评估前由 {@link ArticleService} 重新读取文章，确保使用摘要治理后的最新标题、
     * 摘要、关键要点和正文片段，而不是采集刚落库时的旧对象。
     * </p>
     *
     * @param articles 本次采集新入库的文章
     * @return 标签评估失败告警；全部成功时返回 {@code null}
     */
    public String evaluateArticlesConcurrently(List<Article> articles) {
        if (articles == null || articles.isEmpty()) {
            return null;
        }
        log.info("Concurrently evaluating tags for {} articles", articles.size());

        AtomicInteger failureCount = new AtomicInteger();
        List<CompletableFuture<Void>> futures = articles.stream()
                .map(article -> CompletableFuture.runAsync(() -> {
                    boolean success = articleService.evaluateArticleTags(article.getId());
                    if (!success) {
                        failureCount.incrementAndGet();
                        log.warn("Tag evaluation produced no selected tags for article {}", article.getId());
                    }
                }, llmTaskExecutor).exceptionally(ex -> {
                    failureCount.incrementAndGet();
                    log.warn("Tag evaluation failed for article {}: {}", article.getId(), ex.getMessage());
                    return null;
                }))
                .toList();

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                .orTimeout(TAG_BATCH_TIMEOUT_MINUTES, TimeUnit.MINUTES)
                .exceptionally(ex -> {
                    failureCount.incrementAndGet();
                    log.warn("Tag batch evaluation partially timed out after {} min: {}",
                            TAG_BATCH_TIMEOUT_MINUTES, ex.getMessage());
                    return null;
                })
                .join();

        log.info("Tag batch evaluation complete for {} articles", articles.size());
        if (failureCount.get() > 0) {
            return CollectionFailureClassifier.TAG_EVALUATION_FAILED
                    + ": " + failureCount.get() + " 篇文章标签评估失败";
        }
        return null;
    }
}
