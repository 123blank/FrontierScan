package com.frontierscan.category;

import com.frontierscan.article.ArticleRepository;
import com.frontierscan.common.error.BusinessRuleException;
import com.frontierscan.common.error.ResourceNotFoundException;
import com.frontierscan.site.SiteRepository;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("CategoryService")
class CategoryServiceTest {

    private static final Long USER_ID = 1L;
    private static final Long CATEGORY_ID = 10L;

    @Mock private CategoryRepository categoryRepository;
    @Mock private SiteRepository siteRepository;
    @Mock private ArticleRepository articleRepository;

    private CategoryService categoryService;

    @BeforeEach
    void setUp() {
        categoryService = new CategoryService(categoryRepository, siteRepository, articleRepository);
    }

    @Test
    @DisplayName("create trims fields and rejects duplicate names")
    void shouldNormalizeAndRejectDuplicateCreate() {
        when(categoryRepository.existsByUserIdAndNameIgnoreCase(USER_ID, "AI News")).thenReturn(false);
        when(categoryRepository.save(any(Category.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Category created = categoryService.create(USER_ID, "  AI News  ", "  frontier updates  ", 20);

        assertThat(created.getName()).isEqualTo("AI News");
        assertThat(created.getDescription()).isEqualTo("frontier updates");
        assertThat(created.getSortOrder()).isEqualTo(20);
        assertThat(created.getArchived()).isFalse();

        when(categoryRepository.existsByUserIdAndNameIgnoreCase(USER_ID, "AI News")).thenReturn(true);
        assertThatThrownBy(() -> categoryService.create(USER_ID, "AI News", null, null))
                .isInstanceOf(BusinessRuleException.class)
                .hasMessageContaining("同名分类已存在");
    }

    @Test
    @DisplayName("update rejects duplicate names except itself")
    void shouldRejectDuplicateUpdateName() {
        Category category = category("AI", false);
        when(categoryRepository.findByIdAndUserId(CATEGORY_ID, USER_ID)).thenReturn(Optional.of(category));
        when(categoryRepository.existsByUserIdAndNameIgnoreCaseAndIdNot(USER_ID, "Backend", CATEGORY_ID))
                .thenReturn(true);

        assertThatThrownBy(() -> categoryService.update(USER_ID, CATEGORY_ID, " Backend ", null, null, null))
                .isInstanceOf(BusinessRuleException.class)
                .hasMessageContaining("同名分类已存在");

        verify(categoryRepository, never()).save(any(Category.class));
    }

    @Test
    @DisplayName("delete rejects categories referenced by sites or articles")
    void shouldRejectDeletingReferencedCategory() {
        when(categoryRepository.findByIdAndUserId(CATEGORY_ID, USER_ID))
                .thenReturn(Optional.of(category("AI", false)));
        when(siteRepository.existsByUserIdAndCategoryId(USER_ID, CATEGORY_ID)).thenReturn(true);

        assertThatThrownBy(() -> categoryService.delete(USER_ID, CATEGORY_ID))
                .isInstanceOf(BusinessRuleException.class)
                .hasMessageContaining("已被网站或文章使用");

        verify(categoryRepository, never()).delete(any(Category.class));
    }

    @Test
    @DisplayName("list views include usage counters")
    void shouldListViewsWithCounters() {
        Category category = category("AI", false);
        when(categoryRepository.findByUserIdAndArchivedFalseOrderBySortOrderAsc(USER_ID))
                .thenReturn(List.of(category));
        when(siteRepository.countByUserIdAndCategoryId(USER_ID, CATEGORY_ID)).thenReturn(3L);
        when(articleRepository.countByUserIdAndCategoryId(USER_ID, CATEGORY_ID)).thenReturn(9L);

        List<CategoryView> views = categoryService.listViewsByUser(USER_ID, false);

        assertThat(views).singleElement().satisfies(view -> {
            assertThat(view.name()).isEqualTo("AI");
            assertThat(view.siteCount()).isEqualTo(3L);
            assertThat(view.articleCount()).isEqualTo(9L);
        });
    }

    @Test
    @DisplayName("get hides categories not owned by current user")
    void shouldHideUnownedCategory() {
        when(categoryRepository.findByIdAndUserId(CATEGORY_ID, USER_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> categoryService.getById(USER_ID, CATEGORY_ID))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    private Category category(String name, boolean archived) {
        Category category = new Category();
        category.setId(CATEGORY_ID);
        category.setUserId(USER_ID);
        category.setName(name);
        category.setDescription("desc");
        category.setSortOrder(0);
        category.setArchived(archived);
        category.setCreatedAt(OffsetDateTime.now());
        category.setUpdatedAt(OffsetDateTime.now());
        return category;
    }
}
