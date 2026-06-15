package com.frontierscan.collection;

import com.frontierscan.site.SiteService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link CollectionRunService} 单元测试。
 * <p>
 * 使用 Mockito 隔离数据库和异步采集编排器，聚焦任务状态流转、重试审计字段、
 * 用户隔离校验和退避时间计算，避免单元测试触发真实网络采集。
 * </p>
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("CollectionRunService 单元测试")
class CollectionRunServiceTest {

    @Mock
    private CollectionRunRepository collectionRunRepository;

    @Mock
    private SiteService siteService;

    @Mock
    private CollectionOrchestrator collectionOrchestrator;

    private CollectionRunService service;

    private static final Long USER_ID = 1L;
    private static final Long OTHER_USER_ID = 2L;
    private static final Long SITE_ID = 10L;
    private static final Long RUN_ID = 100L;

    @BeforeEach
    void setUp() {
        service = new CollectionRunService(collectionRunRepository, siteService, collectionOrchestrator);
    }

    @Nested
    @DisplayName("失败记录")
    class FailureRecording {

        @Test
        @DisplayName("fail 写入结构化失败信息并生成 5 分钟后的下次重试时间")
        void shouldRecordFailureMetadataAndNextRetryTime() {
            CollectionRun run = createRun(CollectionRunService.STATUS_RUNNING, 0);
            when(collectionRunRepository.findById(RUN_ID)).thenReturn(Optional.of(run));
            when(collectionRunRepository.save(any(CollectionRun.class))).thenAnswer(invocation -> invocation.getArgument(0));

            OffsetDateTime before = OffsetDateTime.now().plusMinutes(4);
            OffsetDateTime nextRetryAt = service.fail(
                    RUN_ID,
                    CollectionFailureClassifier.NETWORK_TIMEOUT,
                    CollectionFailureClassifier.STAGE_RSS,
                    "连接超时");

            assertThat(run.getStatus()).isEqualTo(CollectionRunService.STATUS_FAILED);
            assertThat(run.getFailureType()).isEqualTo(CollectionFailureClassifier.NETWORK_TIMEOUT);
            assertThat(run.getFailureStage()).isEqualTo(CollectionFailureClassifier.STAGE_RSS);
            assertThat(run.getErrorMessage()).isEqualTo("连接超时");
            assertThat(nextRetryAt).isAfter(before);
            assertThat(run.getNextRetryAt()).isEqualTo(nextRetryAt);
        }

        @Test
        @DisplayName("第三次自动重试失败后不再生成下次重试时间")
        void shouldStopRetryAfterMaxRetryCount() {
            CollectionRun run = createRun(CollectionRunService.STATUS_RUNNING, 3);
            when(collectionRunRepository.findById(RUN_ID)).thenReturn(Optional.of(run));
            when(collectionRunRepository.save(any(CollectionRun.class))).thenAnswer(invocation -> invocation.getArgument(0));

            OffsetDateTime nextRetryAt = service.fail(
                    RUN_ID,
                    CollectionFailureClassifier.EMPTY_RESULT,
                    CollectionFailureClassifier.STAGE_HTML,
                    "HTML 未解析到可采集文章");

            assertThat(nextRetryAt).isNull();
            assertThat(run.getNextRetryAt()).isNull();
        }

        @Test
        @DisplayName("listDueRetries 查询时限制 retryCount 小于最大自动重试次数")
        void shouldQueryOnlyRunsBelowMaxRetryCount() {
            OffsetDateTime now = OffsetDateTime.now();

            service.listDueRetries(now);

            verify(collectionRunRepository)
                    .findByStatusAndNextRetryAtLessThanEqualAndRetryCountLessThanOrderByNextRetryAtAsc(
                            CollectionRunService.STATUS_FAILED,
                            now,
                            CollectionRunService.MAX_AUTO_RETRY_COUNT);
        }
    }

    @Nested
    @DisplayName("手动重试")
    class ManualRetry {

        @Test
        @DisplayName("retry 为失败任务创建 MANUAL_RETRY 新任务并异步投递")
        void shouldCreateManualRetryRun() {
            CollectionRun failedRun = createRun(CollectionRunService.STATUS_FAILED, 0);
            failedRun.setNextRetryAt(OffsetDateTime.now().plusMinutes(5));
            CollectionRun retryRun = createRun(CollectionRunService.STATUS_RUNNING, 1);
            retryRun.setId(200L);
            retryRun.setRunType(CollectionRunService.RUN_TYPE_MANUAL_RETRY);
            retryRun.setRetryOfRunId(failedRun.getId());

            when(collectionRunRepository.findById(RUN_ID)).thenReturn(Optional.of(failedRun));
            when(collectionRunRepository.existsBySiteIdAndStatus(SITE_ID, CollectionRunService.STATUS_RUNNING))
                    .thenReturn(false);
            when(collectionRunRepository.save(any(CollectionRun.class))).thenAnswer(invocation -> {
                CollectionRun saved = invocation.getArgument(0);
                if (saved.getId() == null) {
                    saved.setId(200L);
                }
                return saved;
            });
            when(collectionOrchestrator.executeCollection(USER_ID, SITE_ID, 200L))
                    .thenReturn(CompletableFuture.completedFuture(200L));

            CollectionRun result = service.retry(RUN_ID, USER_ID);

            assertThat(result.getRunType()).isEqualTo(CollectionRunService.RUN_TYPE_MANUAL_RETRY);
            assertThat(result.getRetryCount()).isEqualTo(1);
            assertThat(result.getRetryOfRunId()).isEqualTo(RUN_ID);
            assertThat(failedRun.getNextRetryAt()).isNull();
            verify(siteService).resetFailureCount(SITE_ID);
            verify(collectionOrchestrator).executeCollection(USER_ID, SITE_ID, result.getId());
        }

        @Test
        @DisplayName("retry 不允许重试其他用户的任务")
        void shouldRejectOtherUserRun() {
            CollectionRun failedRun = createRun(CollectionRunService.STATUS_FAILED, 0);
            failedRun.setUserId(OTHER_USER_ID);
            when(collectionRunRepository.findById(RUN_ID)).thenReturn(Optional.of(failedRun));

            assertThatThrownBy(() -> service.retry(RUN_ID, USER_ID))
                    .isInstanceOf(RuntimeException.class)
                    .hasMessageContaining("任务不存在");
            verify(collectionOrchestrator, never()).executeCollection(anyLong(), anyLong(), anyLong());
        }

        @Test
        @DisplayName("retry 不允许重试非 FAILED 任务")
        void shouldRejectNonFailedRun() {
            CollectionRun runningRun = createRun(CollectionRunService.STATUS_RUNNING, 0);
            when(collectionRunRepository.findById(RUN_ID)).thenReturn(Optional.of(runningRun));

            assertThatThrownBy(() -> service.retry(RUN_ID, USER_ID))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("只能重试已失败的任务");
        }

        @Test
        @DisplayName("retry 创建新任务失败时，不应清空原失败任务和站点健康状态")
        void shouldKeepFailureStateWhenCreatingRetryRunFails() {
            CollectionRun failedRun = createRun(CollectionRunService.STATUS_FAILED, 0);
            OffsetDateTime nextRetryAt = OffsetDateTime.now().plusMinutes(5);
            failedRun.setNextRetryAt(nextRetryAt);

            when(collectionRunRepository.findById(RUN_ID)).thenReturn(Optional.of(failedRun));
            when(collectionRunRepository.existsBySiteIdAndStatus(SITE_ID, CollectionRunService.STATUS_RUNNING))
                    .thenReturn(true);

            assertThatThrownBy(() -> service.retry(RUN_ID, USER_ID))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("已有运行中的采集任务");

            assertThat(failedRun.getNextRetryAt()).isEqualTo(nextRetryAt);
            verify(siteService, never()).resetFailureCount(SITE_ID);
            verify(collectionRunRepository, never()).save(failedRun);
            verify(collectionOrchestrator, never()).executeCollection(anyLong(), anyLong(), anyLong());
        }
    }

    /** 创建基础采集任务夹具。 */
    private CollectionRun createRun(String status, int retryCount) {
        CollectionRun run = new CollectionRun();
        run.setId(RUN_ID);
        run.setUserId(USER_ID);
        run.setSiteId(SITE_ID);
        run.setRunType(CollectionRunService.RUN_TYPE_MANUAL);
        run.setStatus(status);
        run.setStartedAt(OffsetDateTime.now());
        run.setCollectedCount(0);
        run.setRetryCount(retryCount);
        return run;
    }
}
