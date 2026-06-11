package com.frontierscan.site;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

/**
 * 网站数据访问接口。
 * <p>
 * 提供按用户和分类维度的网站查询，以及启停状态筛选能力。
 * </p>
 */
public interface SiteRepository extends JpaRepository<Site, Long> {

    /** 查询指定用户的所有网站。 */
    List<Site> findByUserId(Long userId);

    /** 查询指定用户在指定分类下的所有网站。 */
    List<Site> findByUserIdAndCategoryId(Long userId, Long categoryId);

    /** 查询指定用户处于启用状态的所有网站（用于定时采集调度）。 */
    List<Site> findByUserIdAndEnabledTrue(Long userId);

    /** 统计指定用户在指定分类下的网站数量。 */
    long countByUserIdAndCategoryId(Long userId, Long categoryId);
}