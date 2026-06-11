package com.frontierscan.category;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface CategoryRepository extends JpaRepository<Category, Long> {
    List<Category> findByUserIdOrderBySortOrderAsc(Long userId);
    List<Category> findByUserIdAndArchivedFalseOrderBySortOrderAsc(Long userId);
}
