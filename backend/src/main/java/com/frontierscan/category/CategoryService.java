package com.frontierscan.category;

import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.List;

@Service
public class CategoryService {

    private final CategoryRepository categoryRepository;

    public CategoryService(CategoryRepository categoryRepository) {
        this.categoryRepository = categoryRepository;
    }

    public List<Category> listByUser(Long userId, boolean includeArchived) {
        if (includeArchived) {
            return categoryRepository.findByUserIdOrderBySortOrderAsc(userId);
        }
        return categoryRepository.findByUserIdAndArchivedFalseOrderBySortOrderAsc(userId);
    }

    public Category getById(Long id) {
        return categoryRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("分类不存在"));
    }

    public Category create(Long userId, String name, String description, Integer sortOrder) {
        Category category = new Category();
        category.setUserId(userId);
        category.setName(name);
        category.setDescription(description);
        category.setSortOrder(sortOrder != null ? sortOrder : 0);
        category.setArchived(false);
        category.setCreatedAt(OffsetDateTime.now());
        category.setUpdatedAt(OffsetDateTime.now());
        return categoryRepository.save(category);
    }

    public Category update(Long id, String name, String description, Integer sortOrder, Boolean archived) {
        Category category = getById(id);
        if (name != null) category.setName(name);
        if (description != null) category.setDescription(description);
        if (sortOrder != null) category.setSortOrder(sortOrder);
        if (archived != null) category.setArchived(archived);
        category.setUpdatedAt(OffsetDateTime.now());
        return categoryRepository.save(category);
    }

    public void delete(Long id) {
        categoryRepository.deleteById(id);
    }
}
