package com.frontierscan.article;

import com.frontierscan.common.error.ResourceNotFoundException;
import com.frontierscan.llm.LlmProvider;
import com.frontierscan.llm.SummaryQualityEvaluator;
import com.frontierscan.llm.SummaryResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link ArticleSummaryService} 文章级摘要治理单元测试。
 * <p>
 * 使用 Mockito 隔离数据库和 LLM 依赖，重点验证状态流转、用户隔离和失败兜底。
 * 这些规则直接影响前端是否展示“重新生成摘要”按钮，必须保持可回归。
 * </p>
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("ArticleSummaryService 摘要治理")
class ArticleSummaryServiceTest {

    @Mock
    private ArticleRepository articleRepository;
    @Mock
    private LlmProvider llmProvider;

    private ArticleSummaryService articleSummaryService;

    @BeforeEach
    void setUp() {
        articleSummaryService = new ArticleSummaryService(
                articleRepository,
                llmProvider,
                new SummaryQualityEvaluator());
        lenient().when(articleRepository.save(any(Article.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    @DisplayName("合格摘要写入 COMPLETED 状态")
    void shouldMarkCompletedForQualifiedSummary() {
        Article article = article(1L, 10L);
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(llmProvider.summarize(any())).thenReturn(new SummaryResult(
                "治理标题",
                "文章介绍了摘要治理的整体方案，重点说明文章级状态、质量评分和人工重试入口。"
                        + "这些机制能够让用户识别失败或低质量摘要，并在详情页完成重新生成。",
                List.of("文章级状态", "质量评分", "人工重试"),
                List.of("LLM", "摘要治理")));

        Article updated = articleSummaryService.retrySummary(10L, article.getId());

        assertThat(updated.getSummaryStatus()).isEqualTo(ArticleSummaryStatus.COMPLETED);
        assertThat(updated.getSummaryQualityScore()).isGreaterThanOrEqualTo(SummaryQualityEvaluator.PASS_SCORE);
        assertThat(updated.getSummaryQualityReason()).isNull();
        assertThat(updated.getSummaryRetryCount()).isEqualTo(1);
        assertThat(updated.getSummaryUpdatedAt()).isNotNull();
    }

    @Test
    @DisplayName("低质量摘要保存内容但标记 LOW_QUALITY")
    void shouldMarkLowQualityWhenScoreLow() {
        Article article = article(2L, 10L);
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(llmProvider.summarize(any())).thenReturn(
                new SummaryResult(null, "太短。", List.of("要点1"), List.of()));

        Article updated = articleSummaryService.retrySummary(10L, article.getId());

        assertThat(updated.getSummaryStatus()).isEqualTo(ArticleSummaryStatus.LOW_QUALITY);
        assertThat(updated.getSummary()).isEqualTo("太短。");
        assertThat(updated.getSummaryQualityReason()).contains("摘要过短");
    }

    @Test
    @DisplayName("正文缺失时不调用 LLM 并标记 FAILED")
    void shouldFailWhenContentMissing() {
        Article article = article(3L, 10L);
        article.setContentExcerpt(" ");
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));

        Article updated = articleSummaryService.retrySummary(10L, article.getId());

        assertThat(updated.getSummaryStatus()).isEqualTo(ArticleSummaryStatus.FAILED);
        assertThat(updated.getSummaryQualityReason()).contains("缺少可用于摘要的正文内容");
        verify(llmProvider, org.mockito.Mockito.never()).summarize(any());
    }

    @Test
    @DisplayName("重新摘要未返回要点或标签时清空旧值")
    void shouldClearOldKeyPointsAndTagsWhenNewResultIsEmpty() {
        Article article = article(6L, 10L);
        article.setKeyPoints("旧要点1\n旧要点2");
        article.setTags("旧标签");
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(llmProvider.summarize(any())).thenReturn(new SummaryResult(
                null,
                "这是一段重新生成后的摘要内容，虽然模型没有返回新的要点和标签，但系统必须清理旧字段，避免详情页把不同轮次的摘要信息混合展示。",
                List.of(),
                List.of()));

        Article updated = articleSummaryService.retrySummary(10L, article.getId());

        assertThat(updated.getSummary()).contains("重新生成后的摘要内容");
        assertThat(updated.getKeyPoints()).isNull();
        assertThat(updated.getTags()).isNull();
        assertThat(updated.getSummaryStatus()).isEqualTo(ArticleSummaryStatus.LOW_QUALITY);
    }

    @Test
    @DisplayName("LLM 空返回时标记 FAILED")
    void shouldFailWhenLlmReturnsNull() {
        Article article = article(4L, 10L);
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(llmProvider.summarize(any())).thenReturn(null);

        Article updated = articleSummaryService.retrySummary(10L, article.getId());

        assertThat(updated.getSummaryStatus()).isEqualTo(ArticleSummaryStatus.FAILED);
        assertThat(updated.getSummaryQualityScore()).isZero();
        assertThat(updated.getSummaryQualityReason()).contains("LLM 未返回有效摘要");
    }

    @Test
    @DisplayName("不能重试其他用户的文章")
    void shouldProtectUserIsolation() {
        Article article = article(5L, 10L);
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));

        assertThatThrownBy(() -> articleSummaryService.retrySummary(99L, article.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    private static Article article(Long id, Long userId) {
        Article article = new Article();
        article.setId(id);
        article.setUserId(userId);
        article.setSiteId(100L);
        article.setCategoryId(200L);
        article.setTitle("测试文章");
        article.setSourceUrl("https://example.com/article-" + id);
        article.setSourceHash("hash-" + id);
        article.setContentExcerpt("这是一段用于摘要生成的正文内容，包含足够的信息用于模型生成结构化摘要。");
        article.setCollectedAt(OffsetDateTime.now());
        article.setCreatedAt(OffsetDateTime.now());
        article.setSummaryStatus(ArticleSummaryStatus.PENDING);
        article.setSummaryRetryCount(0);
        return article;
    }
}
