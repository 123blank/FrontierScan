package com.frontierscan.collection;

import org.springframework.stereotype.Service;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 采集任务管理业务服务。
 * <p>
 * 提供任务的创建、完成和失败状态流转能力。
 * 任务状态机：RUNNING → COMPLETED / FAILED。
 * </p>
 */
@Service
public class CollectionRunService {

    private final CollectionRunRepository collectionRunRepository;

    public CollectionRunService(CollectionRunRepository collectionRunRepository) {
        this.collectionRunRepository = collectionRunRepository;
    }

    /** 查询指定用户的历史采集记录。 */
    /** 根据 ID 获取采集任务。 */
    public CollectionRun getById(Long id) {
        return collectionRunRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("采集任务不存在"));
    }

    public List<CollectionRun> listByUser(Long userId) {
        return collectionRunRepository.findByUserIdOrderByStartedAtDesc(userId);
    }

    /**
     * 创建新的采集任务记录。
     *
     * @param userId  任务发起用户
     * @param siteId  目标网站（null 表示全量采集）
     * @param runType 任务类型（MANUAL / SCHEDULED）
     * @return 创建的任务记录（状态为 RUNNING）
     */
    public CollectionRun create(Long userId, Long siteId, String runType) {
        CollectionRun run = new CollectionRun();
        run.setUserId(userId);
        run.setSiteId(siteId);
        run.setRunType(runType);
        run.setStatus("RUNNING");
        run.setStartedAt(OffsetDateTime.now());
        run.setCollectedCount(0);
        return collectionRunRepository.save(run);
    }

    /** 将任务标记为完成。 */
    public void complete(Long runId, int collectedCount) {
        CollectionRun run = collectionRunRepository.findById(runId)
                .orElseThrow(() -> new RuntimeException("任务不存在"));
        run.setStatus("COMPLETED");
        run.setFinishedAt(OffsetDateTime.now());
        run.setCollectedCount(collectedCount);
        collectionRunRepository.save(run);
    }

    /** 将任务标记为失败。 */
    public void fail(Long runId, String errorMessage) {
        CollectionRun run = collectionRunRepository.findById(runId)
                .orElseThrow(() -> new RuntimeException("任务不存在"));
        run.setStatus("FAILED");
        run.setFinishedAt(OffsetDateTime.now());
        run.setErrorMessage(errorMessage);
        collectionRunRepository.save(run);
    }
}