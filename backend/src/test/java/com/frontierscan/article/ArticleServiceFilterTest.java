package com.frontierscan.article;

import com.frontierscan.collection.CollectResult;
import com.frontierscan.llm.tag.TagEvaluationAgent;
import com.frontierscan.llm.tag.mapper.ArticleTagMappingMapper;
import com.frontierscan.llm.LlmProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * {@link ArticleService} 筛选逻辑单元测试。
 * <p>
 * <b>测试策略：</b>使用 Mockito 模拟所有 Repository 依赖，验证 Service 层在不同筛选条件下的方法委托和结果处理逻辑。
 * 不加载 Spring 上下文。Mockito 使用严格存根（strict stubbing），未使用的存根会导致测试失败。
 * </p>
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("ArticleService 筛选逻辑单元测试")
class ArticleServiceFilterTest {

    @Mock
    private ArticleRepository articleRepository;
    @Mock
    private FavoriteRepository favoriteRepository;
    @Mock
    private TagEvaluationAgent tagEvaluationAgent;
    @Mock
    private ArticleTagMappingMapper articleTagMappingMapper;

    private ArticleService articleService;
    private List<FavoriteArticleView> allFavorites;

    private static final Long USER_ID = 1L;
    private static final Long CATEGORY_ID = 5L;
    private static final Long TAG_ID = 10L;
    private static final String KEYWORD = "AI";
    private static final String DATE_STR = "2026-06-01";

    @BeforeEach
    void setUp() {
        articleService = new ArticleService(articleRepository, favoriteRepository,
                tagEvaluationAgent, articleTagMappingMapper, new LlmProperties(null, null, null, null, null, null));
    }

    @Nested
    @DisplayName("listByUser 筛选委托行为")
    class ListByUserDelegation {

        @Test
        @DisplayName("无筛选条件时调用 JPA 派生查询（无 categoryId）")
        void shouldUseJpaDerivedQueryWhenNoFilters() {
            when(articleRepository.findByUserIdOrderByCollectedAtDesc(eq(USER_ID), any(Pageable.class)))
                    .thenReturn(Page.empty());

            articleService.listByUser(USER_ID, null, null, null, null, null, null, PageRequest.of(0, 10));

            verify(articleRepository).findByUserIdOrderByCollectedAtDesc(eq(USER_ID), any(Pageable.class));
        }

        @Test
        @DisplayName("categoryId 筛选走 JPA 派生查询")
        void shouldUseJpaDerivedQueryForCategory() {
            when(articleRepository.findByUserIdAndCategoryIdOrderByCollectedAtDesc(eq(USER_ID), eq(CATEGORY_ID), any()))
                    .thenReturn(Page.empty());

            articleService.listByUser(USER_ID, CATEGORY_ID, null, null, null, null, null, PageRequest.of(0, 10));

            verify(articleRepository).findByUserIdAndCategoryIdOrderByCollectedAtDesc(eq(USER_ID), eq(CATEGORY_ID), any());
        }

        @Test
        @DisplayName("有关键词时委托原生 SQL findWithFilters")
        void shouldDelegateToNativeQueryWhenKeywordPresent() {
            when(articleRepository.findWithFilters(anyLong(), any(), any(), anyString(), any(), any(), any(), any()))
                    .thenReturn(Page.empty());

            articleService.listByUser(USER_ID, null, null, KEYWORD, null, null, null, PageRequest.of(0, 10));

            verify(articleRepository).findWithFilters(anyLong(), any(), any(), anyString(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("有 tagId 时委托原生 SQL findWithFilters")
        void shouldDelegateToNativeQueryWhenTagIdPresent() {
            when(articleRepository.findWithFilters(anyLong(), any(), any(), any(), anyLong(), any(), any(), any()))
                    .thenReturn(Page.empty());

            articleService.listByUser(USER_ID, null, null, null, TAG_ID, null, null, PageRequest.of(0, 10));

            verify(articleRepository).findWithFilters(anyLong(), any(), any(), any(), anyLong(), any(), any(), any());
        }

        @Test
        @DisplayName("有日期参数时委托原生 SQL findWithFilters")
        void shouldDelegateToNativeQueryWhenDatePresent() {
            when(articleRepository.findWithFilters(anyLong(), any(), any(), any(), any(), anyString(), any(), any()))
                    .thenReturn(Page.empty());

            articleService.listByUser(USER_ID, null, null, null, null, DATE_STR, null, PageRequest.of(0, 10));

            verify(articleRepository).findWithFilters(anyLong(), any(), any(), any(), any(), anyString(), any(), any());
        }
    }

    @Test
    @DisplayName("批量保存新文章时写入全文正文并保留片段")
    void shouldSaveFullContentAndExcerptForNewArticles() {
        String fullContent = "这是采集器清洗后的全文正文，用于摘要 Map-Reduce。";
        String excerpt = "这是列表展示片段。";
        CollectResult.RawArticle rawArticle = CollectResult.RawArticle.builder()
                .title("全文文章")
                .sourceUrl("https://example.com/full")
                .content(fullContent)
                .contentExcerpt(excerpt)
                .sourceHash("hash-full")
                .build();
        when(articleRepository.existsBySourceHash("hash-full")).thenReturn(false);
        when(articleRepository.saveAll(anyList())).thenAnswer(invocation -> invocation.getArgument(0));

        List<Article> saved = articleService.batchSaveArticles(USER_ID, 11L, 22L, List.of(rawArticle));

        assertThat(saved).hasSize(1);
        assertThat(saved.get(0).getContentFull()).isEqualTo(fullContent);
        assertThat(saved.get(0).getContentExcerpt()).isEqualTo(excerpt);
    }

    @Test
    @DisplayName("批量保存按全局 sourceHash 去重，跨用户重复文章不再入库")
    void shouldDeduplicateByGlobalSourceHash() {
        CollectResult.RawArticle rawArticle = CollectResult.RawArticle.builder()
                .title("跨用户重复文章")
                .sourceUrl("https://example.com/duplicated")
                .content("全文")
                .contentExcerpt("片段")
                .sourceHash("global-hash")
                .build();
        when(articleRepository.existsBySourceHash("global-hash")).thenReturn(true);

        List<Article> saved = articleService.batchSaveArticles(99L, 11L, 22L, List.of(rawArticle));

        assertThat(saved).isEmpty();
        verify(articleRepository, never()).saveAll(anyList());
        verify(articleRepository, never()).existsByUserIdAndSourceHash(anyLong(), anyString());
    }

    @Test
    @DisplayName("标签评估使用受控全文作为正文兜底")
    void shouldUseControlledFullContentForTagEvaluation() {
        Article article = new Article();
        article.setId(100L);
        article.setTitle("标签文章");
        article.setSummary("摘要内容");
        article.setKeyPoints("关键要点");
        article.setContentFull("x".repeat(9000));
        article.setContentExcerpt("片段内容");
        when(articleRepository.findById(100L)).thenReturn(Optional.of(article));
        when(tagEvaluationAgent.evaluate(eq(100L), eq("标签文章"), anyString())).thenReturn(List.of());

        articleService.evaluateArticleTags(100L);

        verify(tagEvaluationAgent).evaluate(eq(100L), eq("标签文章"),
                argThat(content -> content.contains("正文兜底：")
                        && content.contains("摘要内容")
                        && content.length() < 8300));
    }

    @Nested
    @DisplayName("listFavoriteArticlesWithFilters 内存过滤逻辑")
    class FavoritesFiltering {

        @BeforeEach
        void setUpFavorites() {
            var fav1 = mockFavoriteView(100L, "AI 深度学习文章", "深度学习摘要", OffsetDateTime.now().minusDays(1));
            var fav2 = mockFavoriteView(200L, "云计算架构文章", "云原生摘要", OffsetDateTime.now().minusDays(2));
            var fav3 = mockFavoriteView(300L, "前端趋势文章", "Vue3 摘要", OffsetDateTime.now().minusDays(3));
            allFavorites = List.of(fav1, fav2, fav3);
            when(favoriteRepository.findFavoriteArticleViewsByUserId(USER_ID)).thenReturn(allFavorites);
        }

        @Test
        @DisplayName("关键词按标题匹配")
        void shouldFilterByKeywordInTitle() {
            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, "AI", null, null, null);

            assertThat(result).hasSize(1);
            assertThat(result.get(0).title()).contains("AI");
        }

        @Test
        @DisplayName("关键词按摘要匹配")
        void shouldFilterByKeywordInSummary() {
            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, "云原生", null, null, null);

            assertThat(result).hasSize(1);
            assertThat(result.get(0).title()).contains("云计算");
        }

        @Test
        @DisplayName("空关键词不触发过滤")
        void shouldNotFilterWithBlankKeyword() {
            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, "", null, null, null);

            assertThat(result).hasSize(3);
        }

        @Test
        @DisplayName("tagId 筛选")
        void shouldFilterByTagId() {
            when(articleTagMappingMapper.findArticleIdsByTagId(10L)).thenReturn(List.of(100L));

            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, null, 10L, null, null);

            assertThat(result).hasSize(1);
            assertThat(result.get(0).articleId()).isEqualTo(100L);
        }

        @Test
        @DisplayName("空标签列表过滤后无结果")
        void shouldReturnEmptyWhenTagMatchEmpty() {
            when(articleTagMappingMapper.findArticleIdsByTagId(999L)).thenReturn(List.of());

            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, null, 999L, null, null);

            assertThat(result).isEmpty();
        }

        @Test
        @DisplayName("起始日期筛选")
        void shouldFilterByStartDate() {
            var start = OffsetDateTime.now().minusDays(2).minusMinutes(1);
            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, null, null, start, null);

            assertThat(result).hasSize(2);
        }

        @Test
        @DisplayName("截止日期筛选")
        void shouldFilterByEndDate() {
            var end = OffsetDateTime.now().minusDays(2);
            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, null, null, null, end);

            assertThat(result).hasSize(2);
        }

        @Test
        @DisplayName("组合筛选：关键词 + 标签 + 日期")
        void shouldFilterCombined() {
            when(articleTagMappingMapper.findArticleIdsByTagId(10L)).thenReturn(List.of(100L, 200L));

            var start = OffsetDateTime.now().minusDays(2).minusMinutes(1);
            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, "云", 10L, start, null);

            assertThat(result).hasSize(1);
        }

        @Test
        @DisplayName("无筛选条件返回全部收藏")
        void shouldReturnAllWhenNoFilters() {
            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, null, null, null, null);

            assertThat(result).hasSize(3);
        }
    }

    private FavoriteArticleView mockFavoriteView(Long articleId, String title, String summary, OffsetDateTime publishedAt) {
        return new FavoriteArticleView(
                1000L + articleId, articleId, title, summary,
                "要点1\n要点2", "标签1,标签2",
                "https://example.com/" + articleId,
                publishedAt, OffsetDateTime.now(), OffsetDateTime.now());
    }
}
