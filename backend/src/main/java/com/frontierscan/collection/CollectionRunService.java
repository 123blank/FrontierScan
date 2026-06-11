package com.frontierscan.collection;

import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.List;

@Service
public class CollectionRunService {

    private final CollectionRunRepository collectionRunRepository;

    public CollectionRunService(CollectionRunRepository collectionRunRepository) {
        this.collectionRunRepository = collectionRunRepository;
    }

    public List<CollectionRun> listByUser(Long userId) {
        return collectionRunRepository.findByUserIdOrderByStartedAtDesc(userId);
    }

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

    public void complete(Long runId, int collectedCount) {
        CollectionRun run = collectionRunRepository.findById(runId)
                .orElseThrow(() -> new RuntimeException("任务不存在"));
        run.setStatus("COMPLETED");
        run.setFinishedAt(OffsetDateTime.now());
        run.setCollectedCount(collectedCount);
        collectionRunRepository.save(run);
    }

    public void fail(Long runId, String errorMessage) {
        CollectionRun run = collectionRunRepository.findById(runId)
                .orElseThrow(() -> new RuntimeException("任务不存在"));
        run.setStatus("FAILED");
        run.setFinishedAt(OffsetDateTime.now());
        run.setErrorMessage(errorMessage);
        collectionRunRepository.save(run);
    }
}
