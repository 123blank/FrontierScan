package com.frontierscan.category;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

/**
 * 分类数据访问接口。
 * <p>
 * 提供按用户查询和排序的支持，以及已归档/未归档分类的筛选能力。
 * </p>
 */
public interface CategoryRepository extends JpaRepository<Category, Long> {

    /**
     * 查询指定用户的所有分类（按排序序号升序）。
     *
     * @param userId 用户 ID
     * @return 分类列表
     */
    List<Category> findByUserIdOrderBySortOrderAsc(Long userId);

    /**
     * 查询指定用户的未归档分类（按排序序号升序）。
     *
     * @param userId 用户 ID
     * @return 未归档分类列表
     */
    List<Category> findByUserIdAndArchivedFalseOrderBySortOrderAsc(Long userId);

    /**
     * 查询指定用户拥有的单个分类。
     *
     * @param id 分类 ID
     * @param userId 当前用户 ID
     * @return 分类对象；不存在或不属于当前用户时为空
     */
    Optional<Category> findByIdAndUserId(Long id, Long userId);

    /**
     * 判断分类是否属于指定用户。
     * <p>网站创建和更新时使用该方法校验分类归属，防止跨用户挂载。</p>
     */
    boolean existsByIdAndUserId(Long id, Long userId);

    boolean existsByUserIdAndNameIgnoreCase(Long userId, String name);

    boolean existsByUserIdAndNameIgnoreCaseAndIdNot(Long userId, String name, Long id);
}
