package com.frontierscan.article;

import com.frontierscan.common.error.ResourceNotFoundException;
import com.frontierscan.llm.SummaryQualityEvaluator;
import com.frontierscan.llm.SummaryQualityResult;
import com.frontierscan.llm.SummaryRequest;
import com.frontierscan.llm.SummaryResult;
import com.frontierscan.llm.SummaryMapReduceException;
import com.frontierscan.llm.SummaryMapReduceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.OffsetDateTime;

/**
 * 文章级 LLM 摘要治理服务。
 * <p>
 * 该服务统一承接采集后的首次摘要生成和用户手动重新生成摘要：
 * 先记录尝试时间，再调用 LLM，随后通过 {@link SummaryQualityEvaluator} 写入质量状态。
 * 这样前端不需要从采集任务告警中反推单篇文章状态，也能保证用户只能治理自己的文章。
 * </p>
 */
@Slf4j
@Service
public class ArticleSummaryService {

    private static final String MISSING_CONTENT_REASON = "缺少可用于摘要的正文内容";
    private static final String EMPTY_LLM_REASON = "LLM 未返回有效摘要";

    private final ArticleRepository articleRepository;
    private final ArticleService articleService;
    private final SummaryMapReduceService summaryMapReduceService;
    private final SummaryQualityEvaluator qualityEvaluator;

    public ArticleSummaryService(ArticleRepository articleRepository,
                                 ArticleService articleService,
                                 SummaryMapReduceService summaryMapReduceService,
                                 SummaryQualityEvaluator qualityEvaluator) {
        this.articleRepository = articleRepository;
        this.articleService = articleService;
        this.summaryMapReduceService = summaryMapReduceService;
        this.qualityEvaluator = qualityEvaluator;
    }

    /**
     * 采集链路中为新入库文章生成摘要。
     * <p>该方法不校验用户入参，因为调用方已经在采集任务中完成站点和文章归属校验。</p>
     *
     * @param articleId 新入库文章 ID
     * @return 更新后的文章；若文章不存在则返回 {@code null}
     */
    public Article summarizeCollectedArticle(Long articleId) {
        return articleRepository.findById(articleId)
                .map(article -> generateAndPersist(article, false))
                .orElse(null);
    }

    /**
     * 用户手动重新生成摘要。
     * <p>
     * 重试接口必须先校验文章归属，资源不存在或不属于当前用户统一返回 404，
     * 防止用户通过文章 ID 探测其他用户的采集数据。
     * </p>
     */
    public Article retrySummary(Long userId, Long articleId) {
        Article article = articleRepository.findById(articleId)
                .orElseThrow(() -> new ResourceNotFoundException("文章不存在"));
        if (!article.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("文章不存在");
        }
        return generateAndPersist(article, true);
    }

    /**
     * 执行摘要生成并落库状态。
     * <p>
     * LLM 调用可能耗时，因此这里只在关键节点调用 Repository 保存，
     * 避免长事务包裹外部网络请求。若调用失败，文章状态会落为 FAILED，
     * 但不会影响采集任务主流程的 COMPLETED 状态。
     * </p>
     */
    private Article generateAndPersist(Article article, boolean manualRetry) {
        OffsetDateTime now = OffsetDateTime.now();
        article.setSummaryStatus(ArticleSummaryStatus.PENDING);
        article.setSummaryLastAttemptAt(now);
        article.setSummaryQualityReason(null);
        if (manualRetry) {
            article.setSummaryRetryCount(safeRetryCount(article) + 1);
        }
        articleRepository.save(article);

        String sourceContent = resolveSummarySourceContent(article);
        if (isBlank(sourceContent)) {
            return markFailed(article, MISSING_CONTENT_REASON);
        }

        try {
            SummaryResult result = summaryMapReduceService.summarize(new SummaryRequest(
                    article.getTitle(),
                    article.getSourceUrl(),
                    sourceContent));
            if (result == null || isBlank(result.summary())) {
                return markFailed(article, EMPTY_LLM_REASON);
            }
            Article updated = applySummaryResult(article, result);
            if (manualRetry) {
                // 手动重摘要成功后同步重评标签，使结构化标签与最新摘要、要点和标题保持一致。
                articleService.evaluateArticleTags(updated.getId());
            }
            return updated;
        } catch (SummaryMapReduceException e) {
            log.warn("LLM summary Map-Reduce failed for article {}: {}", article.getId(), e.getMessage());
            return markFailed(article, e.getMessage());
        } catch (Exception e) {
            log.warn("LLM summary generation failed for article {}: {}", article.getId(), e.getMessage());
            return markFailed(article, "LLM 摘要生成失败：" + e.getMessage());
        }
    }

    /**
     * 选择摘要输入正文。
     * <p>
     * 新文章优先使用 contentFull；历史文章在本期未回填全文时回退到 contentExcerpt，
     * 保证用户仍可对旧数据执行摘要治理。
     * </p>
     */
    private static String resolveSummarySourceContent(Article article) {
        if (!isBlank(article.getContentFull())) {
            return article.getContentFull();
        }
        return article.getContentExcerpt();
    }

    /**
     * 写入 LLM 返回内容，并根据规则评分决定最终状态。
     * <p>LOW_QUALITY 仍保存摘要内容，因为用户可能希望先阅读再决定是否重试。</p>
     */
    @Transactional
    protected Article applySummaryResult(Article article, SummaryResult result) {
        if (!isBlank(result.optimizedTitle())) {
            article.setTitle(result.optimizedTitle());
        }
        article.setSummary(result.summary());
        // 每次摘要治理都以本轮 LLM 结果为准；当模型未返回要点或标签时主动清空旧值，避免前端混用历史摘要字段。
        article.setKeyPoints(result.keyPoints() != null && !result.keyPoints().isEmpty()
                ? String.join("\n", result.keyPoints())
                : null);
        article.setTags(result.tags() != null && !result.tags().isEmpty()
                ? String.join(",", result.tags())
                : null);

        SummaryQualityResult quality = qualityEvaluator.evaluate(result, resolveSummarySourceContent(article));
        article.setSummaryQualityScore(quality.score());
        article.setSummaryQualityReason(quality.qualified() ? null : quality.reason());
        article.setSummaryStatus(quality.qualified()
                ? ArticleSummaryStatus.COMPLETED
                : ArticleSummaryStatus.LOW_QUALITY);
        article.setSummaryUpdatedAt(OffsetDateTime.now());
        return articleRepository.save(article);
    }

    /** 将摘要状态标记为失败，并保留失败原因供前端展示。 */
    @Transactional
    protected Article markFailed(Article article, String reason) {
        article.setSummaryStatus(ArticleSummaryStatus.FAILED);
        article.setSummaryQualityScore(0);
        article.setSummaryQualityReason(reason);
        return articleRepository.save(article);
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static int safeRetryCount(Article article) {
        return article.getSummaryRetryCount() == null ? 0 : article.getSummaryRetryCount();
    }
}
