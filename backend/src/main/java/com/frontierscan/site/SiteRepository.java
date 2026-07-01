package com.frontierscan.site;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

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

    /**
     * 查询所有处于启用状态的网站。
     * <p>
     * 定时采集调度器按全局维度扫描启用站点，再按站点自身的用户 ID 创建隔离的采集任务。
     * 该方法不接收 userId，是因为后台调度需要覆盖所有用户的启用信息源。
     * </p>
     */
    List<Site> findByEnabledTrue();

    /**
     * 查询指定用户拥有的单个网站。
     *
     * @param id 网站 ID
     * @param userId 当前用户 ID
     * @return 网站对象；不存在或不属于当前用户时为空
     */
    Optional<Site> findByIdAndUserId(Long id, Long userId);

    /** 统计指定用户在指定分类下的网站数量。 */
    long countByUserIdAndCategoryId(Long userId, Long categoryId);

    boolean existsByUserIdAndCategoryId(Long userId, Long categoryId);
}
