package com.frontierscan.collection;

import com.frontierscan.site.Site;
import com.frontierscan.site.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link CollectionScheduler} 定时调度器单元测试。
 * <p>
 * <b>测试策略：</b>使用 Mockito 隔离数据库、Redis 和采集编排器，只验证调度器自身的业务决策：
 * 到期判断、RUNNING 防重、Redis 分布式锁、Redis 不可用降级、异步任务完成后的锁释放。
 * 这样可以在不启动 Spring 容器、不连接外部服务的情况下快速覆盖核心分支。
 * </p>
 *
 * <p><b>边界说明：</b>调度器的私有方法不直接反射测试，而是统一通过
 * {@link CollectionScheduler#scheduleDueCollections()} 入口触发，保证测试关注外部可观察行为。</p>
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("CollectionScheduler 定时调度器单元测试")
class CollectionSchedulerTest {

    /** 站点仓储 Mock：控制本轮调度扫描到的启用站点。 */
    @Mock
    private SiteRepository siteRepository;

    /** 采集任务仓储 Mock：控制最近任务和 RUNNING 任务判断。 */
    @Mock
    private CollectionRunRepository collectionRunRepository;

    /** 采集任务服务 Mock：验证调度器是否创建 SCHEDULED 任务。 */
    @Mock
    private CollectionRunService collectionRunService;

    /** 采集编排器 Mock：验证调度器是否投递异步采集任务。 */
    @Mock
    private CollectionOrchestrator collectionOrchestrator;

    /** Redis 模板提供器 Mock：用于模拟有 Redis、无 Redis 和 Redis 故障三种场景。 */
    @Mock
    private ObjectProvider<StringRedisTemplate> redisTemplateProvider;

    /** Redis 字符串模板 Mock：模拟站点级分布式锁。 */
    @Mock
    private StringRedisTemplate redisTemplate;

    /** Redis value 操作 Mock：模拟 SETNX、GET、DELETE。 */
    @Mock
    private ValueOperations<String, String> valueOperations;

    private CollectionScheduler scheduler;
    private Site dueSite;
    private CollectionRun createdRun;

    @BeforeEach
    void setUp() {
        scheduler = new CollectionScheduler(
                siteRepository,
                collectionRunRepository,
                collectionRunService,
                collectionOrchestrator,
                new CollectionScheduleProperties(true, 60_000L, 30L),
                redisTemplateProvider
        );

        dueSite = createSite(10L, 100L, 1);
        createdRun = createRun(900L, dueSite.getUserId(), dueSite.getId(), "SCHEDULED", OffsetDateTime.now());
    }

    @Nested
    @DisplayName("到期调度")
    class DueScheduling {

        @Test
        @DisplayName("站点从未采集过时，应创建 SCHEDULED 任务并投递异步采集")
        void shouldCreateScheduledRunWhenSiteNeverCollected() {
            when(siteRepository.findByEnabledTrue()).thenReturn(List.of(dueSite));
            when(collectionRunRepository.findFirstBySiteIdOrderByStartedAtDesc(dueSite.getId()))
                    .thenReturn(Optional.empty());
            when(collectionRunRepository.existsBySiteIdAndStatus(dueSite.getId(), "RUNNING"))
                    .thenReturn(false);
            when(redisTemplateProvider.getIfAvailable()).thenReturn(null);
            when(collectionRunService.create(dueSite.getUserId(), dueSite.getId(), "SCHEDULED"))
                    .thenReturn(createdRun);
            when(collectionOrchestrator.executeCollection(dueSite.getUserId(), dueSite.getId(), createdRun.getId()))
                    .thenReturn(CompletableFuture.completedFuture(createdRun.getId()));

            scheduler.scheduleDueCollections();

            verify(collectionRunService).create(dueSite.getUserId(), dueSite.getId(), "SCHEDULED");
            verify(collectionOrchestrator).executeCollection(dueSite.getUserId(), dueSite.getId(), createdRun.getId());
        }

        @Test
        @DisplayName("最近任务已经超过站点采集间隔时，应再次调度")
        void shouldScheduleWhenLatestRunExceedsInterval() {
            CollectionRun oldRun = createRun(1L, dueSite.getUserId(), dueSite.getId(),
                    "SCHEDULED", OffsetDateTime.now().minusMinutes(3));

            when(siteRepository.findByEnabledTrue()).thenReturn(List.of(dueSite));
            when(collectionRunRepository.findFirstBySiteIdOrderByStartedAtDesc(dueSite.getId()))
                    .thenReturn(Optional.of(oldRun));
            when(collectionRunRepository.existsBySiteIdAndStatus(dueSite.getId(), "RUNNING"))
                    .thenReturn(false);
            when(redisTemplateProvider.getIfAvailable()).thenReturn(null);
            when(collectionRunService.create(dueSite.getUserId(), dueSite.getId(), "SCHEDULED"))
                    .thenReturn(createdRun);
            when(collectionOrchestrator.executeCollection(any(), any(), any()))
                    .thenReturn(CompletableFuture.completedFuture(createdRun.getId()));

            scheduler.scheduleDueCollections();

            verify(collectionRunService).create(dueSite.getUserId(), dueSite.getId(), "SCHEDULED");
        }
    }

    @Nested
    @DisplayName("防重复调度")
    class DuplicateProtection {

        @Test
        @DisplayName("最近任务仍在采集间隔内时，应跳过调度")
        void shouldSkipWhenLatestRunStillWithinInterval() {
            CollectionRun recentRun = createRun(1L, dueSite.getUserId(), dueSite.getId(),
                    "SCHEDULED", OffsetDateTime.now());

            when(siteRepository.findByEnabledTrue()).thenReturn(List.of(dueSite));
            when(collectionRunRepository.findFirstBySiteIdOrderByStartedAtDesc(dueSite.getId()))
                    .thenReturn(Optional.of(recentRun));

            scheduler.scheduleDueCollections();

            verify(collectionRunService, never()).create(any(), any(), anyString());
            verify(collectionOrchestrator, never()).executeCollection(any(), any(), any());
        }

        @Test
        @DisplayName("站点已有 RUNNING 任务时，应跳过调度")
        void shouldSkipWhenRunningRunExists() {
            when(siteRepository.findByEnabledTrue()).thenReturn(List.of(dueSite));
            when(collectionRunRepository.findFirstBySiteIdOrderByStartedAtDesc(dueSite.getId()))
                    .thenReturn(Optional.empty());
            when(collectionRunRepository.existsBySiteIdAndStatus(dueSite.getId(), "RUNNING"))
                    .thenReturn(true);

            scheduler.scheduleDueCollections();

            verify(collectionRunService, never()).create(any(), any(), anyString());
            verify(collectionOrchestrator, never()).executeCollection(any(), any(), any());
        }
    }

    @Nested
    @DisplayName("失败任务自动重试")
    class ScheduledRetry {

        @Test
        @DisplayName("失败任务到达 nextRetryAt 时，应创建 SCHEDULED_RETRY 任务并投递采集")
        void shouldCreateScheduledRetryWhenFailedRunIsDue() {
            CollectionRun failedRun = createRun(700L, dueSite.getUserId(), dueSite.getId(),
                    CollectionRunService.RUN_TYPE_SCHEDULED, OffsetDateTime.now().minusMinutes(10));
            failedRun.setStatus(CollectionRunService.STATUS_FAILED);
            failedRun.setRetryCount(0);
            failedRun.setNextRetryAt(OffsetDateTime.now().minusMinutes(1));
            CollectionRun retryRun = createRun(701L, dueSite.getUserId(), dueSite.getId(),
                    CollectionRunService.RUN_TYPE_SCHEDULED_RETRY, OffsetDateTime.now());
            retryRun.setRetryCount(1);
            retryRun.setRetryOfRunId(failedRun.getId());

            when(collectionRunService.listDueRetries(any(OffsetDateTime.class))).thenReturn(List.of(failedRun));
            when(siteRepository.findById(dueSite.getId())).thenReturn(Optional.of(dueSite));
            when(collectionRunRepository.existsBySiteIdAndStatus(dueSite.getId(), CollectionRunService.STATUS_RUNNING))
                    .thenReturn(false);
            when(redisTemplateProvider.getIfAvailable()).thenReturn(null);
            when(collectionRunService.createScheduledRetry(failedRun)).thenReturn(retryRun);
            when(collectionOrchestrator.executeCollection(dueSite.getUserId(), dueSite.getId(), retryRun.getId()))
                    .thenReturn(CompletableFuture.completedFuture(retryRun.getId()));
            when(siteRepository.findByEnabledTrue()).thenReturn(List.of());

            scheduler.scheduleDueCollections();

            verify(collectionRunService).createScheduledRetry(failedRun);
            verify(collectionOrchestrator).executeCollection(dueSite.getUserId(), dueSite.getId(), retryRun.getId());
        }

        @Test
        @DisplayName("没有到期失败任务时，不应创建自动重试任务")
        void shouldSkipWhenNoFailedRetryIsDue() {
            when(collectionRunService.listDueRetries(any(OffsetDateTime.class))).thenReturn(List.of());
            when(siteRepository.findByEnabledTrue()).thenReturn(List.of());

            scheduler.scheduleDueCollections();

            verify(collectionRunService, never()).createScheduledRetry(any());
        }

        @Test
        @DisplayName("失败任务关联站点已有 RUNNING 任务时，应跳过自动重试")
        void shouldSkipRetryWhenSiteHasRunningRun() {
            CollectionRun failedRun = createRun(700L, dueSite.getUserId(), dueSite.getId(),
                    CollectionRunService.RUN_TYPE_SCHEDULED, OffsetDateTime.now().minusMinutes(10));
            failedRun.setStatus(CollectionRunService.STATUS_FAILED);
            failedRun.setRetryCount(1);
            failedRun.setNextRetryAt(OffsetDateTime.now().minusMinutes(1));

            when(collectionRunService.listDueRetries(any(OffsetDateTime.class))).thenReturn(List.of(failedRun));
            when(siteRepository.findById(dueSite.getId())).thenReturn(Optional.of(dueSite));
            when(collectionRunRepository.existsBySiteIdAndStatus(dueSite.getId(), CollectionRunService.STATUS_RUNNING))
                    .thenReturn(true);
            when(siteRepository.findByEnabledTrue()).thenReturn(List.of());

            scheduler.scheduleDueCollections();

            verify(collectionRunService, never()).createScheduledRetry(any());
            verify(collectionOrchestrator, never()).executeCollection(any(), any(), any());
        }
    }

    @Nested
    @DisplayName("Redis 分布式锁")
    class RedisLocking {

        @Test
        @DisplayName("Redis 锁被其他实例持有时，应跳过调度")
        void shouldSkipWhenRedisLockIsHeld() {
            mockDueSiteWithRedis();
            when(valueOperations.setIfAbsent(eq("frontierscan:collection:site:" + dueSite.getId()),
                    anyString(), any(Duration.class))).thenReturn(false);

            scheduler.scheduleDueCollections();

            verify(collectionRunService, never()).create(any(), any(), anyString());
            verify(collectionOrchestrator, never()).executeCollection(any(), any(), any());
        }

        @Test
        @DisplayName("Redis 可用且锁获取成功时，任务完成后应释放本人持有的锁")
        void shouldReleaseOwnedRedisLockWhenAsyncTaskCompletes() {
            mockDueSiteWithRedis();
            ArgumentCaptor<String> tokenCaptor = ArgumentCaptor.forClass(String.class);

            when(valueOperations.setIfAbsent(eq("frontierscan:collection:site:" + dueSite.getId()),
                    tokenCaptor.capture(), any(Duration.class))).thenReturn(true);
            when(collectionRunService.create(dueSite.getUserId(), dueSite.getId(), "SCHEDULED"))
                    .thenReturn(createdRun);
            when(collectionOrchestrator.executeCollection(dueSite.getUserId(), dueSite.getId(), createdRun.getId()))
                    .thenReturn(CompletableFuture.completedFuture(createdRun.getId()));
            when(valueOperations.get("frontierscan:collection:site:" + dueSite.getId()))
                    .thenAnswer(invocation -> tokenCaptor.getValue());

            scheduler.scheduleDueCollections();

            assertThat(tokenCaptor.getValue()).isNotBlank();
            verify(redisTemplate).delete("frontierscan:collection:site:" + dueSite.getId());
        }

        @Test
        @DisplayName("Redis 不可用时，应降级为数据库 RUNNING 防重并继续调度")
        void shouldContinueWhenRedisUnavailable() {
            mockDueSiteWithRedis();
            when(valueOperations.setIfAbsent(eq("frontierscan:collection:site:" + dueSite.getId()),
                    anyString(), any(Duration.class))).thenThrow(new RedisConnectionFailureException("redis down"));
            when(collectionRunService.create(dueSite.getUserId(), dueSite.getId(), "SCHEDULED"))
                    .thenReturn(createdRun);
            when(collectionOrchestrator.executeCollection(dueSite.getUserId(), dueSite.getId(), createdRun.getId()))
                    .thenReturn(CompletableFuture.completedFuture(createdRun.getId()));

            scheduler.scheduleDueCollections();

            verify(collectionRunService).create(dueSite.getUserId(), dueSite.getId(), "SCHEDULED");
            verify(collectionOrchestrator).executeCollection(dueSite.getUserId(), dueSite.getId(), createdRun.getId());
        }

        /**
         * 准备一个到期站点，并让调度器走 Redis 锁分支。
         * <p>该夹具封装重复 Mock 设置，使每个用例只表达自身关注的锁行为。</p>
         */
        private void mockDueSiteWithRedis() {
            when(siteRepository.findByEnabledTrue()).thenReturn(List.of(dueSite));
            when(collectionRunRepository.findFirstBySiteIdOrderByStartedAtDesc(dueSite.getId()))
                    .thenReturn(Optional.empty());
            when(collectionRunRepository.existsBySiteIdAndStatus(dueSite.getId(), "RUNNING"))
                    .thenReturn(false);
            when(redisTemplateProvider.getIfAvailable()).thenReturn(redisTemplate);
            when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        }
    }

    /** 创建测试站点。 */
    private Site createSite(Long id, Long userId, int intervalMinutes) {
        Site site = new Site();
        site.setId(id);
        site.setUserId(userId);
        site.setCategoryId(200L);
        site.setName("调度测试站点");
        site.setUrl("https://example.com");
        site.setRssUrl("https://example.com/rss");
        site.setCollectionIntervalMinutes(intervalMinutes);
        site.setEnabled(true);
        site.setCreatedAt(OffsetDateTime.now());
        site.setUpdatedAt(OffsetDateTime.now());
        return site;
    }

    /** 创建测试采集任务记录。 */
    private CollectionRun createRun(Long id, Long userId, Long siteId, String runType, OffsetDateTime startedAt) {
        CollectionRun run = new CollectionRun();
        run.setId(id);
        run.setUserId(userId);
        run.setSiteId(siteId);
        run.setRunType(runType);
        run.setStatus("RUNNING");
        run.setStartedAt(startedAt);
        run.setCollectedCount(0);
        return run;
    }
}
