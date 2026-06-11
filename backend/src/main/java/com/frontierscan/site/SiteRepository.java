package com.frontierscan.site;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface SiteRepository extends JpaRepository<Site, Long> {
    List<Site> findByUserId(Long userId);
    List<Site> findByUserIdAndCategoryId(Long userId, Long categoryId);
    List<Site> findByUserIdAndEnabledTrue(Long userId);
    long countByUserIdAndCategoryId(Long userId, Long categoryId);
}
