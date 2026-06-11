package com.frontierscan.category;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

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
}