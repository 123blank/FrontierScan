package com.frontierscan.collection;

import com.frontierscan.article.Article;
import com.frontierscan.article.ArticleService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import java.util.List;
import java.util.concurrent.Executor;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * {@link TagEvaluationAsyncService} 标签评估非阻断告警测试。
 * <p>
 * 标签评估依赖 LLM，不能影响采集主任务完成。本测试使用同步 Executor 隔离线程调度复杂度，
 * 只验证成功/失败计数和告警文案生成规则。
 * </p>
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("TagEvaluationAsyncService 标签评估告警")
class TagEvaluationAsyncServiceTest {

    @Mock
    private ArticleService articleService;

    private TagEvaluationAsyncService service;

    @BeforeEach
    void setUp() {
        Executor directExecutor = Runnable::run;
        service = new TagEvaluationAsyncService(articleService, directExecutor);
    }

    @Test
    @DisplayName("全部文章标签评估成功时不产生告警")
    void shouldReturnNullWhenAllArticlesTagged() {
        Article article = article(1L);
        when(articleService.evaluateArticleTags(1L)).thenReturn(true);

        String warning = service.evaluateArticlesConcurrently(List.of(article));

        assertThat(warning).isNull();
    }

    @Test
    @DisplayName("存在文章标签评估失败时返回非阻断告警")
    void shouldReturnWarningWhenTagEvaluationFails() {
        Article article = article(2L);
        when(articleService.evaluateArticleTags(2L)).thenReturn(false);

        String warning = service.evaluateArticlesConcurrently(List.of(article));

        assertThat(warning).contains(CollectionFailureClassifier.TAG_EVALUATION_FAILED);
    }

    private static Article article(Long id) {
        Article article = new Article();
        article.setId(id);
        article.setTitle("测试文章");
        return article;
    }
}
