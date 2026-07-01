package com.frontierscan.category;

import com.frontierscan.article.ArticleRepository;
import com.frontierscan.common.error.BusinessRuleException;
import com.frontierscan.common.error.ResourceNotFoundException;
import com.frontierscan.site.SiteRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Category domain service.
 *
 * Categories are user-owned navigation buckets. They organize sites first, and
 * collected articles inherit the category from their source site.
 */
@Service
public class CategoryService {

    private final CategoryRepository categoryRepository;
    private final SiteRepository siteRepository;
    private final ArticleRepository articleRepository;

    public CategoryService(CategoryRepository categoryRepository,
                           SiteRepository siteRepository,
                           ArticleRepository articleRepository) {
        this.categoryRepository = categoryRepository;
        this.siteRepository = siteRepository;
        this.articleRepository = articleRepository;
    }

    public List<Category> listByUser(Long userId, boolean includeArchived) {
        if (includeArchived) {
            return categoryRepository.findByUserIdOrderBySortOrderAsc(userId);
        }
        return categoryRepository.findByUserIdAndArchivedFalseOrderBySortOrderAsc(userId);
    }

    public List<CategoryView> listViewsByUser(Long userId, boolean includeArchived) {
        return listByUser(userId, includeArchived).stream()
                .map(category -> toView(userId, category))
                .toList();
    }

    public Category getById(Long userId, Long id) {
        return categoryRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new ResourceNotFoundException("分类不存在"));
    }

    public CategoryView getViewById(Long userId, Long id) {
        return toView(userId, getById(userId, id));
    }

    @Transactional
    public Category create(Long userId, String name, String description, Integer sortOrder) {
        String normalizedName = normalizeName(name);
        ensureNameAvailableForCreate(userId, normalizedName);

        Category category = new Category();
        category.setUserId(userId);
        category.setName(normalizedName);
        category.setDescription(normalizeOptional(description));
        category.setSortOrder(sortOrder != null ? sortOrder : 0);
        category.setArchived(false);
        category.setCreatedAt(OffsetDateTime.now());
        category.setUpdatedAt(OffsetDateTime.now());
        return categoryRepository.save(category);
    }

    public CategoryView createView(Long userId, String name, String description, Integer sortOrder) {
        return toView(userId, create(userId, name, description, sortOrder));
    }

    @Transactional
    public Category update(Long userId, Long id, String name, String description, Integer sortOrder, Boolean archived) {
        Category category = getById(userId, id);
        if (name != null) {
            String normalizedName = normalizeName(name);
            ensureNameAvailableForUpdate(userId, category.getId(), normalizedName);
            category.setName(normalizedName);
        }
        if (description != null) {
            category.setDescription(normalizeOptional(description));
        }
        if (sortOrder != null) {
            category.setSortOrder(sortOrder);
        }
        if (archived != null) {
            category.setArchived(archived);
        }
        category.setUpdatedAt(OffsetDateTime.now());
        return categoryRepository.save(category);
    }

    public CategoryView updateView(Long userId, Long id, String name, String description,
                                   Integer sortOrder, Boolean archived) {
        return toView(userId, update(userId, id, name, description, sortOrder, archived));
    }

    @Transactional
    public void delete(Long userId, Long id) {
        Category category = getById(userId, id);
        if (siteRepository.existsByUserIdAndCategoryId(userId, id)
                || articleRepository.existsByUserIdAndCategoryId(userId, id)) {
            throw new BusinessRuleException("分类已被网站或文章使用，请先归档或迁移关联数据");
        }
        categoryRepository.delete(category);
    }

    private CategoryView toView(Long userId, Category category) {
        return CategoryView.of(
                category,
                siteRepository.countByUserIdAndCategoryId(userId, category.getId()),
                articleRepository.countByUserIdAndCategoryId(userId, category.getId())
        );
    }

    private String normalizeName(String name) {
        String normalized = name == null ? "" : name.trim();
        if (normalized.isEmpty()) {
            throw new BusinessRuleException("分类名称不能为空");
        }
        if (normalized.length() > 120) {
            throw new BusinessRuleException("分类名称不能超过120个字符");
        }
        return normalized;
    }

    private String normalizeOptional(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private void ensureNameAvailableForCreate(Long userId, String name) {
        if (categoryRepository.existsByUserIdAndNameIgnoreCase(userId, name)) {
            throw new BusinessRuleException("同名分类已存在");
        }
    }

    private void ensureNameAvailableForUpdate(Long userId, Long id, String name) {
        if (categoryRepository.existsByUserIdAndNameIgnoreCaseAndIdNot(userId, name, id)) {
            throw new BusinessRuleException("同名分类已存在");
        }
    }
}
