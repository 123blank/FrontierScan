package com.frontierscan.collection;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

/**
 * 采集任务运行记录数据访问接口。
 * <p>
 * 提供用户维度的任务历史查询，支持按网站筛选。
 * </p>
 */
public interface CollectionRunRepository extends JpaRepository<CollectionRun, Long> {

    /** 查询指定用户的采集任务记录（按开始时间倒序）。 */
    List<CollectionRun> findByUserIdOrderByStartedAtDesc(Long userId);

    /** 查询指定用户对指定网站的历史采集记录。 */
    List<CollectionRun> findByUserIdAndSiteIdOrderByStartedAtDesc(Long userId, Long siteId);

    /**
     * 查询指定网站最近一次采集记录。
     * <p>
     * 定时调度器使用该记录计算下一次可采集时间。这里不限制任务状态，
     * 因为失败任务同样代表系统已经在该时间点尝试过采集，应纳入调度间隔判断。
     * </p>
     */
    Optional<CollectionRun> findFirstBySiteIdOrderByStartedAtDesc(Long siteId);

    /**
     * 判断指定网站是否已有运行中的采集任务。
     * <p>
     * 用于调度前的数据库级防重，即使 Redis 不可用，也能避免单实例内同一站点重复采集。
     * </p>
     */
    boolean existsBySiteIdAndStatus(Long siteId, String status);
}
