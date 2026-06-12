package com.frontierscan.article;

import com.frontierscan.llm.tag.ArticleTagMappingRepository;
import com.frontierscan.llm.tag.TagEvaluationAgent;
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
    private ArticleTagMappingRepository articleTagMappingRepository;

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
                tagEvaluationAgent, articleTagMappingRepository);
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
            when(articleTagMappingRepository.findArticleIdsByTagId(10L)).thenReturn(List.of(100L));

            var result = articleService.listFavoriteArticlesWithFilters(USER_ID, null, 10L, null, null);

            assertThat(result).hasSize(1);
            assertThat(result.get(0).articleId()).isEqualTo(100L);
        }

        @Test
        @DisplayName("空标签列表过滤后无结果")
        void shouldReturnEmptyWhenTagMatchEmpty() {
            when(articleTagMappingRepository.findArticleIdsByTagId(999L)).thenReturn(List.of());

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
            when(articleTagMappingRepository.findArticleIdsByTagId(10L)).thenReturn(List.of(100L, 200L));

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
