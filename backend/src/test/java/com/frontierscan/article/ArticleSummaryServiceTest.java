package com.frontierscan.article;

import com.frontierscan.common.error.ResourceNotFoundException;
import com.frontierscan.llm.SummaryRequest;
import com.frontierscan.llm.SummaryQualityEvaluator;
import com.frontierscan.llm.SummaryMapReduceService;
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
import static org.mockito.ArgumentCaptor.forClass;
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
    private ArticleService articleService;
    @Mock
    private SummaryMapReduceService summaryMapReduceService;

    private ArticleSummaryService articleSummaryService;

    @BeforeEach
    void setUp() {
        articleSummaryService = new ArticleSummaryService(
                articleRepository,
                articleService,
                summaryMapReduceService,
                new SummaryQualityEvaluator());
        lenient().when(articleRepository.save(any(Article.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    @DisplayName("合格摘要写入 COMPLETED 状态")
    void shouldMarkCompletedForQualifiedSummary() {
        Article article = article(1L, 10L);
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(summaryMapReduceService.summarize(any())).thenReturn(new SummaryResult(
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
        verify(articleService).evaluateArticleTags(article.getId());
    }

    @Test
    @DisplayName("优先使用全文正文生成摘要")
    void shouldUseFullContentWhenAvailable() {
        Article article = article(7L, 10L);
        article.setContentFull("这是采集到的全文正文，长度和语义都超过列表片段，摘要必须基于这个字段生成。");
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(summaryMapReduceService.summarize(any())).thenReturn(new SummaryResult(
                "全文摘要标题",
                "系统优先使用采集到的全文正文生成摘要，避免只根据列表片段得出不完整结论。该机制还保留历史片段兜底，保证旧文章仍可治理。",
                List.of("全文优先", "片段兜底"),
                List.of("摘要治理", "全文")));

        articleSummaryService.retrySummary(10L, article.getId());

        var captor = forClass(SummaryRequest.class);
        verify(summaryMapReduceService).summarize(captor.capture());
        assertThat(captor.getValue().content()).isEqualTo(article.getContentFull());
    }

    @Test
    @DisplayName("历史文章缺少全文时回退正文片段")
    void shouldFallbackToExcerptWhenFullContentMissing() {
        Article article = article(8L, 10L);
        article.setContentFull(null);
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(summaryMapReduceService.summarize(any())).thenReturn(new SummaryResult(
                "历史文章标题",
                "历史文章没有全文字段时，系统会回退到正文片段继续生成摘要，避免旧数据无法使用摘要治理能力。该逻辑保证迁移后功能平滑可用。",
                List.of("历史兼容", "片段兜底"),
                List.of("摘要治理", "兼容")));

        articleSummaryService.retrySummary(10L, article.getId());

        var captor = forClass(SummaryRequest.class);
        verify(summaryMapReduceService).summarize(captor.capture());
        assertThat(captor.getValue().content()).isEqualTo(article.getContentExcerpt());
    }

    @Test
    @DisplayName("低质量摘要保存内容但标记 LOW_QUALITY")
    void shouldMarkLowQualityWhenScoreLow() {
        Article article = article(2L, 10L);
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(summaryMapReduceService.summarize(any())).thenReturn(
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
        verify(summaryMapReduceService, org.mockito.Mockito.never()).summarize(any());
        verify(articleService, org.mockito.Mockito.never()).evaluateArticleTags(article.getId());
    }

    @Test
    @DisplayName("重新摘要未返回要点或标签时清空旧值")
    void shouldClearOldKeyPointsAndTagsWhenNewResultIsEmpty() {
        Article article = article(6L, 10L);
        article.setKeyPoints("旧要点1\n旧要点2");
        article.setTags("旧标签");
        when(articleRepository.findById(article.getId())).thenReturn(Optional.of(article));
        when(summaryMapReduceService.summarize(any())).thenReturn(new SummaryResult(
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
        when(summaryMapReduceService.summarize(any())).thenReturn(null);

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
