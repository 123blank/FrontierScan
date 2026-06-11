package com.frontierscan.category;

import com.frontierscan.common.error.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 分类管理业务服务，提供分类的完整 CRUD 操作。
 * <p>
 * 支持创建、更新、删除和按用户查询分类，
 * 以及通过 {@code includeArchived} 参数控制是否显示已归档分类。
 * </p>
 */
@Service
public class CategoryService {

    private final CategoryRepository categoryRepository;

    public CategoryService(CategoryRepository categoryRepository) {
        this.categoryRepository = categoryRepository;
    }

    /**
     * 查询指定用户的分列表。
     *
     * @param userId          用户 ID
     * @param includeArchived 是否包含已归档分类
     * @return 分类列表
     */
    public List<Category> listByUser(Long userId, boolean includeArchived) {
        if (includeArchived) {
            return categoryRepository.findByUserIdOrderBySortOrderAsc(userId);
        }
        return categoryRepository.findByUserIdAndArchivedFalseOrderBySortOrderAsc(userId);
    }

    /**
     * 根据 ID 获取当前用户拥有的分类。
     *
     * @param userId 当前用户 ID
     * @param id 分类 ID
     * @return 分类对象
     * @throws ResourceNotFoundException 如果分类不存在或不属于当前用户
     */
    public Category getById(Long userId, Long id) {
        return categoryRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new ResourceNotFoundException("分类不存在"));
    }

    /**
     * 创建新的分类。
     *
     * @param userId      所属用户 ID
     * @param name        分类名称
     * @param description 分类描述（可选）
     * @param sortOrder   排序序号（可选，默认 0）
     * @return 创建成功的分类对象
     */
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

    /**
     * 更新分类信息（局部更新，只更新非 null 字段）。
     *
     * @param userId      当前用户 ID
     * @param id          分类 ID
     * @param name        新名称（null 表示不更新）
     * @param description 新描述（null 表示不更新）
     * @param sortOrder   新排序序号（null 表示不更新）
     * @param archived    归档状态（null 表示不更新）
     * @return 更新后的分类对象
     */
    public Category update(Long userId, Long id, String name, String description, Integer sortOrder, Boolean archived) {
        Category category = getById(userId, id);
        if (name != null) category.setName(name);
        if (description != null) category.setDescription(description);
        if (sortOrder != null) category.setSortOrder(sortOrder);
        if (archived != null) category.setArchived(archived);
        category.setUpdatedAt(OffsetDateTime.now());
        return categoryRepository.save(category);
    }

    /**
     * 删除分类。
     *
     * @param userId 当前用户 ID
     * @param id 要删除的分类 ID
     */
    public void delete(Long userId, Long id) {
        Category category = getById(userId, id);
        categoryRepository.delete(category);
    }
}
