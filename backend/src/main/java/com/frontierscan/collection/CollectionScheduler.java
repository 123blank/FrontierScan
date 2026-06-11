package com.frontierscan.collection;

import com.frontierscan.site.Site;
import com.frontierscan.site.SiteRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 定时采集调度器。
 * <p>
 * 按固定间隔扫描启用的网站，根据网站的采集间隔判断是否需要触发采集。
 * Redis 可用时使用短 TTL 分布式锁避免多实例重复调度；Redis 不可用时仍保留数据库
 * RUNNING 状态检查，保证单实例开发环境可以正常工作。
 * </p>
 *
 * <p><b>调度策略：</b></p>
 * <ul>
 *   <li>只扫描 {@link Site#getEnabled()} 为 {@code true} 的站点。</li>
 *   <li>以站点 {@code collectionIntervalMinutes} 和最近一次采集任务的开始时间判断是否到期。</li>
 *   <li>若站点已有 {@code RUNNING} 任务，则跳过本轮调度，避免同一站点并发采集。</li>
 *   <li>触发后创建 {@code SCHEDULED} 类型的 {@link CollectionRun}，实际采集交由 {@link CollectionOrchestrator} 异步执行。</li>
 * </ul>
 *
 * <p><b>锁语义：</b></p>
 * <ul>
 *   <li>Redis 可用时使用 {@code SETNX + TTL} 获取站点级锁，适配多实例部署。</li>
 *   <li>每次加锁写入唯一 token，释放时只删除本实例本任务持有的锁，避免误删其他实例的新锁。</li>
 *   <li>Redis 不可用时不会阻断采集，系统退化为数据库 RUNNING 状态防重，满足单机开发和测试场景。</li>
 * </ul>
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "app.collection", name = "scheduler-enabled", havingValue = "true", matchIfMissing = true)
public class CollectionScheduler {

    /** 定时调度创建的采集任务类型，与手动触发的 MANUAL 任务区分。 */
    private static final String RUN_TYPE_SCHEDULED = "SCHEDULED";

    /** 采集任务运行中状态，用于防止同一站点重复调度。 */
    private static final String STATUS_RUNNING = "RUNNING";

    /** Redis 站点级调度锁前缀，完整 key 形如 {@code frontierscan:collection:site:123}。 */
    private static final String LOCK_PREFIX = "frontierscan:collection:site:";

    /** 站点数据访问接口，用于扫描启用站点。 */
    private final SiteRepository siteRepository;

    /** 采集任务记录访问接口，用于查询最近任务和 RUNNING 状态。 */
    private final CollectionRunRepository collectionRunRepository;

    /** 采集任务状态服务，用于创建 SCHEDULED 任务记录。 */
    private final CollectionRunService collectionRunService;

    /** 采集编排器，负责异步执行真实采集和摘要流程。 */
    private final CollectionOrchestrator collectionOrchestrator;

    /** 定时调度配置，包含扫描间隔和 Redis 锁 TTL。 */
    private final CollectionScheduleProperties properties;

    /** Redis 模板延迟获取器，允许测试环境或 Redis 自动配置关闭时正常启动。 */
    private final ObjectProvider<StringRedisTemplate> redisTemplateProvider;

    /** 当前应用实例标识，用于生成可追踪的 Redis 锁 token。 */
    private final String instanceId = UUID.randomUUID().toString();

    /**
     * 创建定时采集调度器。
     *
     * @param siteRepository 站点数据访问接口
     * @param collectionRunRepository 采集任务数据访问接口
     * @param collectionRunService 采集任务状态服务
     * @param collectionOrchestrator 采集流程编排器
     * @param properties 定时采集配置
     * @param redisTemplateProvider Redis 模板提供器；Redis 不存在时可返回空
     */
    public CollectionScheduler(SiteRepository siteRepository,
                               CollectionRunRepository collectionRunRepository,
                               CollectionRunService collectionRunService,
                               CollectionOrchestrator collectionOrchestrator,
                               CollectionScheduleProperties properties,
                               ObjectProvider<StringRedisTemplate> redisTemplateProvider) {
        this.siteRepository = siteRepository;
        this.collectionRunRepository = collectionRunRepository;
        this.collectionRunService = collectionRunService;
        this.collectionOrchestrator = collectionOrchestrator;
        this.properties = properties;
        this.redisTemplateProvider = redisTemplateProvider;
    }

    /**
     * 扫描到期站点并触发异步采集。
     * <p>
     * 该方法由 Spring Scheduling 按固定延迟触发。方法内部只负责轻量扫描和任务投递，
     * 真实采集逻辑在 {@code collectionTaskExecutor} 线程池中执行，避免阻塞调度线程。
     * 单个站点判断失败时只记录日志并继续处理其他站点，防止某个坏数据影响整轮调度。
     * </p>
     */
    @Scheduled(
            initialDelayString = "${app.collection.scheduler-fixed-delay-ms:60000}",
            fixedDelayString = "${app.collection.scheduler-fixed-delay-ms:60000}"
    )
    public void scheduleDueCollections() {
        List<Site> enabledSites = siteRepository.findByEnabledTrue();
        if (enabledSites.isEmpty()) {
            return;
        }

        OffsetDateTime now = OffsetDateTime.now();
        for (Site site : enabledSites) {
            try {
                scheduleSiteIfDue(site, now);
            } catch (Exception e) {
                log.warn("Scheduled collection check failed for site {}: {}", site.getId(), e.getMessage());
            }
        }
    }

    /**
     * 对单个站点执行到期判断、防重校验、加锁和任务投递。
     *
     * @param site 待检查的启用站点
     * @param now 本轮调度统一使用的当前时间，避免循环过程中时间漂移造成边界不一致
     */
    private void scheduleSiteIfDue(Site site, OffsetDateTime now) {
        if (!isDue(site, now)) {
            return;
        }
        if (collectionRunRepository.existsBySiteIdAndStatus(site.getId(), STATUS_RUNNING)) {
            log.debug("Skip scheduled collection for site {} because a run is already RUNNING", site.getId());
            return;
        }
        String lockToken = acquireLock(site.getId());
        if (lockToken == null) {
            log.debug("Skip scheduled collection for site {} because lock is held", site.getId());
            return;
        }

        try {
            // 先落库 RUNNING 任务，再投递异步采集，便于前端和后续调度立即感知任务状态。
            CollectionRun run = collectionRunService.create(site.getUserId(), site.getId(), RUN_TYPE_SCHEDULED);
            log.info("Scheduled collection triggered: userId={}, siteId={}, runId={}",
                    site.getUserId(), site.getId(), run.getId());
            collectionOrchestrator.executeCollection(site.getUserId(), site.getId(), run.getId())
                    .whenComplete((ignored, ex) -> releaseLock(site.getId(), lockToken));
        } catch (RuntimeException e) {
            releaseLock(site.getId(), lockToken);
            throw e;
        }
    }

    /**
     * 判断站点是否已经达到下一次采集时间。
     * <p>
     * 站点从未采集过时立即到期；已有采集记录时，以最近一次任务的 {@code startedAt}
     * 加上站点采集间隔作为下一次可采集时间。这里使用开始时间而非完成时间，
     * 可以避免长任务把后续调度无限后移。
     * </p>
     *
     * @param site 目标站点
     * @param now 当前调度时间
     * @return {@code true} 表示需要触发采集
     */
    private boolean isDue(Site site, OffsetDateTime now) {
        int intervalMinutes = Optional.ofNullable(site.getCollectionIntervalMinutes()).orElse(1440);
        Optional<CollectionRun> latestRun = collectionRunRepository.findFirstBySiteIdOrderByStartedAtDesc(site.getId());
        return latestRun
                .map(run -> run.getStartedAt().plusMinutes(intervalMinutes).isBefore(now)
                        || run.getStartedAt().plusMinutes(intervalMinutes).isEqual(now))
                .orElse(true);
    }

    /**
     * 获取站点级调度锁。
     * <p>
     * 返回值约定：
     * <ul>
     *   <li>非空字符串：成功获取 Redis 锁，字符串为本次锁 token。</li>
     *   <li>空字符串：Redis 不可用或未配置，调用方可继续执行但无需释放锁。</li>
     *   <li>{@code null}：Redis 锁已被其他实例持有，调用方应跳过本轮调度。</li>
     * </ul>
     * </p>
     *
     * @param siteId 站点 ID
     * @return 锁 token、空字符串或 {@code null}
     */
    private String acquireLock(Long siteId) {
        StringRedisTemplate redisTemplate = redisTemplateProvider.getIfAvailable();
        if (redisTemplate == null) {
            return "";
        }

        String lockToken = instanceId + ":" + UUID.randomUUID();
        try {
            Boolean acquired = redisTemplate.opsForValue().setIfAbsent(
                    LOCK_PREFIX + siteId,
                    lockToken,
                    Duration.ofMinutes(properties.lockTtlMinutes())
            );
            return Boolean.TRUE.equals(acquired) ? lockToken : null;
        } catch (RedisConnectionFailureException e) {
            log.warn("Redis unavailable, scheduled collection continues without distributed lock: {}", e.getMessage());
            return "";
        }
    }

    /**
     * 释放站点级调度锁。
     * <p>
     * 释放前会先比对 Redis 中保存的 token，只有当前任务仍持有该锁时才执行删除。
     * 这样可以避免任务执行时间超过 TTL 后，新任务重新加锁，而旧任务完成时误删新锁。
     * </p>
     *
     * @param siteId 站点 ID
     * @param lockToken 获取锁时返回的唯一 token；为空表示无需释放
     */
    private void releaseLock(Long siteId, String lockToken) {
        if (lockToken == null || lockToken.isBlank()) {
            return;
        }
        StringRedisTemplate redisTemplate = redisTemplateProvider.getIfAvailable();
        if (redisTemplate == null) {
            return;
        }

        String key = LOCK_PREFIX + siteId;
        try {
            if (lockToken.equals(redisTemplate.opsForValue().get(key))) {
                redisTemplate.delete(key);
            }
        } catch (RedisConnectionFailureException e) {
            log.debug("Redis unavailable while releasing scheduled collection lock for site {}: {}",
                    siteId, e.getMessage());
        }
    }
}
