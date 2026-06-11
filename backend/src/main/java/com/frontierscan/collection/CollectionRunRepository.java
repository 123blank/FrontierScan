package com.frontierscan.collection;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

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
}