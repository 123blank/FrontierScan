package com.frontierscan.collection;

import com.frontierscan.site.SiteService;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 采集任务管理业务服务。
 * <p>
 * 统一负责采集任务的创建、完成、失败、手动重试和自动重试状态流转。
 * 可靠性增强后，失败任务不再只保存一段错误文本，而是保存失败类型、失败阶段、
 * 下次重试时间和重试来源，便于前端展示和后续运维排查。
 * </p>
 */
@Service
public class CollectionRunService {

    /** 采集任务运行中状态。 */
    public static final String STATUS_RUNNING = "RUNNING";

    /** 采集任务完成状态。 */
    public static final String STATUS_COMPLETED = "COMPLETED";

    /** 采集任务失败状态。 */
    public static final String STATUS_FAILED = "FAILED";

    /** 手动触发任务类型。 */
    public static final String RUN_TYPE_MANUAL = "MANUAL";

    /** 定时调度任务类型。 */
    public static final String RUN_TYPE_SCHEDULED = "SCHEDULED";

    /** 手动重试任务类型。 */
    public static final String RUN_TYPE_MANUAL_RETRY = "MANUAL_RETRY";

    /** 后台自动重试任务类型。 */
    public static final String RUN_TYPE_SCHEDULED_RETRY = "SCHEDULED_RETRY";

    /** 自动重试最大次数；原始任务 retryCount=0，自动重试最多创建 retryCount=1/2/3。 */
    public static final int MAX_AUTO_RETRY_COUNT = 3;

    /** 固定退避序列：第 1/2/3 次失败后分别等待 5/15/60 分钟。 */
    private static final int[] RETRY_BACKOFF_MINUTES = {5, 15, 60};

    private final CollectionRunRepository collectionRunRepository;
    private final SiteService siteService;
    private final CollectionOrchestrator collectionOrchestrator;

    public CollectionRunService(CollectionRunRepository collectionRunRepository,
                                SiteService siteService,
                                @Lazy CollectionOrchestrator collectionOrchestrator) {
        this.collectionRunRepository = collectionRunRepository;
        this.siteService = siteService;
        this.collectionOrchestrator = collectionOrchestrator;
    }

    /** 查询指定用户的历史采集记录。 */
    public List<CollectionRun> listByUser(Long userId) {
        return collectionRunRepository.findByUserIdOrderByStartedAtDesc(userId);
    }

    /** 根据 ID 获取采集任务。 */
    public CollectionRun getById(Long id) {
        return collectionRunRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("采集任务不存在"));
    }

    /**
     * 创建新的采集任务记录。
     *
     * @param userId  任务发起用户
     * @param siteId  目标网站（null 表示全量采集）
     * @param runType 任务类型
     * @return 创建的任务记录（状态为 RUNNING）
     */
    public CollectionRun create(Long userId, Long siteId, String runType) {
        return create(userId, siteId, runType, 0, null);
    }

    /**
     * 创建新的采集任务记录。
     * <p>
     * 同一站点只允许存在一个 RUNNING 任务，避免手动采集、定时采集和重试采集并发写入同一批文章。
     * 用户隔离由调用方先校验站点归属；任务自身也保存 userId，后续查询和重试均按用户校验。
     * </p>
     */
    @Transactional
    public CollectionRun create(Long userId, Long siteId, String runType, int retryCount, Long retryOfRunId) {
        if (siteId != null && collectionRunRepository.existsBySiteIdAndStatus(siteId, STATUS_RUNNING)) {
            throw new IllegalStateException("该网站已有运行中的采集任务");
        }
        CollectionRun run = new CollectionRun();
        run.setUserId(userId);
        run.setSiteId(siteId);
        run.setRunType(runType);
        run.setStatus(STATUS_RUNNING);
        run.setStartedAt(OffsetDateTime.now());
        run.setCollectedCount(0);
        run.setRetryCount(retryCount);
        run.setRetryOfRunId(retryOfRunId);
        return collectionRunRepository.save(run);
    }

    /** 将任务标记为完成。 */
    @Transactional
    public void complete(Long runId, int collectedCount) {
        complete(runId, collectedCount, null);
    }

    /**
     * 将任务标记为完成并记录非阻断告警。
     * <p>例如 LLM 摘要失败不影响文章落库，此时任务仍为 COMPLETED，但会在任务记录页展示告警。</p>
     */
    @Transactional
    public void complete(Long runId, int collectedCount, String warningMessage) {
        CollectionRun run = getById(runId);
        run.setStatus(STATUS_COMPLETED);
        run.setFinishedAt(OffsetDateTime.now());
        run.setCollectedCount(collectedCount);
        run.setFailureType(null);
        run.setFailureStage(null);
        run.setErrorMessage(null);
        run.setNextRetryAt(null);
        run.setWarningMessage(warningMessage);
        collectionRunRepository.save(run);
    }

    /** 将任务标记为未知失败，保留旧调用点的兼容性。 */
    @Transactional
    public void fail(Long runId, String errorMessage) {
        fail(runId, CollectionFailureClassifier.UNKNOWN, CollectionFailureClassifier.STAGE_UNKNOWN, errorMessage);
    }

    /**
     * 将任务标记为失败并计算下一次自动重试时间。
     * <p>
     * 失败重试采用固定指数退避：原始任务失败后 5 分钟重试，第一次重试失败后 15 分钟，
     * 第二次重试失败后 60 分钟，第三次重试失败后不再自动重试。
     * </p>
     *
     * @return 本次失败任务对应的下一次自动重试时间；超过最大次数时返回 null
     */
    @Transactional
    public OffsetDateTime fail(Long runId, String failureType, String failureStage, String errorMessage) {
        CollectionRun run = getById(runId);
        OffsetDateTime nextRetryAt = calculateNextRetryAt(run.getRetryCount());
        run.setStatus(STATUS_FAILED);
        run.setFinishedAt(OffsetDateTime.now());
        run.setErrorMessage(errorMessage);
        run.setFailureType(failureType);
        run.setFailureStage(failureStage);
        run.setNextRetryAt(nextRetryAt);
        collectionRunRepository.save(run);
        return nextRetryAt;
    }

    /**
     * 手动重试失败任务。
     * <p>
     * 只允许当前用户重试自己的 FAILED 任务。重试会创建新的任务记录，而不是复用旧任务，
     * 这样能保留每一次失败与重试的审计轨迹。
     * </p>
     */
    public CollectionRun retry(Long runId, Long userId) {
        CollectionRun originalRun = getById(runId);
        validateRetryableRun(originalRun, userId);
        CollectionRun newRun = create(
                userId,
                originalRun.getSiteId(),
                RUN_TYPE_MANUAL_RETRY,
                nextRetryCount(originalRun),
                originalRun.getId()
        );
        originalRun.setNextRetryAt(null);
        collectionRunRepository.save(originalRun);
        if (originalRun.getSiteId() != null) {
            siteService.resetFailureCount(originalRun.getSiteId());
        }
        collectionOrchestrator.executeCollection(userId, originalRun.getSiteId(), newRun.getId());
        return newRun;
    }

    /**
     * 为到期失败任务创建后台自动重试任务。
     * <p>调度器已完成到期筛选，本方法只负责再次校验状态并创建可审计的新任务记录。</p>
     */
    @Transactional
    public CollectionRun createScheduledRetry(CollectionRun failedRun) {
        validateRetryableRun(failedRun, failedRun.getUserId());
        failedRun.setNextRetryAt(null);
        collectionRunRepository.save(failedRun);
        return create(
                failedRun.getUserId(),
                failedRun.getSiteId(),
                RUN_TYPE_SCHEDULED_RETRY,
                nextRetryCount(failedRun),
                failedRun.getId()
        );
    }

    /**
     * 查询已经到达自动重试时间的失败任务。
     * <p>只返回 retryCount 小于最大自动重试次数的任务，避免无限循环重试问题站点。</p>
     */
    public List<CollectionRun> listDueRetries(OffsetDateTime now) {
        return collectionRunRepository
                .findByStatusAndNextRetryAtLessThanEqualAndRetryCountLessThanOrderByNextRetryAtAsc(
                        STATUS_FAILED, now, MAX_AUTO_RETRY_COUNT);
    }

    /** 根据当前任务重试序号计算下一次失败后的自动重试时间。 */
    private OffsetDateTime calculateNextRetryAt(Integer retryCount) {
        int currentRetryCount = retryCount != null ? retryCount : 0;
        if (currentRetryCount >= MAX_AUTO_RETRY_COUNT) {
            return null;
        }
        return OffsetDateTime.now().plusMinutes(RETRY_BACKOFF_MINUTES[currentRetryCount]);
    }

    /** 计算新重试任务的重试序号。 */
    private int nextRetryCount(CollectionRun run) {
        return (run.getRetryCount() != null ? run.getRetryCount() : 0) + 1;
    }

    /** 校验失败任务是否允许被当前用户重试。 */
    private void validateRetryableRun(CollectionRun run, Long userId) {
        if (!run.getUserId().equals(userId)) {
            throw new RuntimeException("任务不存在");
        }
        if (!STATUS_FAILED.equals(run.getStatus())) {
            throw new IllegalStateException("只能重试已失败的任务");
        }
        if (run.getSiteId() == null) {
            throw new IllegalStateException("缺少站点信息，无法重试");
        }
    }
}
