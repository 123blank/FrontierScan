package com.frontierscan.site;

import com.frontierscan.category.CategoryRepository;
import com.frontierscan.common.error.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("SiteService 单元测试")
class SiteServiceTest {

    @Mock private SiteRepository siteRepository;
    @Mock private CategoryRepository categoryRepository;

    private SiteService siteService;
    private static final Long USER_ID = 1L;
    private static final Long CATEGORY_ID = 10L;
    private static final Long SITE_ID = 100L;

    @BeforeEach
    void setUp() {
        siteService = new SiteService(siteRepository, categoryRepository);
    }

    @Nested @DisplayName("查询")
    class Query {
        @Test @DisplayName("listByUser 返回用户所有网站")
        void shouldListAllForUser() {
            when(siteRepository.findByUserId(USER_ID)).thenReturn(List.of(new Site(), new Site()));
            assertThat(siteService.listByUser(USER_ID, null)).hasSize(2);
        }

        @Test @DisplayName("listByUser 按分类筛选")
        void shouldFilterByCategory() {
            when(siteRepository.findByUserIdAndCategoryId(USER_ID, CATEGORY_ID)).thenReturn(List.of(new Site()));
            assertThat(siteService.listByUser(USER_ID, CATEGORY_ID)).hasSize(1);
        }

        @Test @DisplayName("getById 返回自己的网站")
        void shouldGetByIdForOwnedSite() {
            var site = createSite();
            when(siteRepository.findByIdAndUserId(SITE_ID, USER_ID)).thenReturn(Optional.of(site));
            assertThat(siteService.getById(USER_ID, SITE_ID)).isSameAs(site);
        }

        @Test @DisplayName("getById 他人网站抛异常")
        void shouldThrowWhenNotOwned() {
            when(siteRepository.findByIdAndUserId(SITE_ID, USER_ID)).thenReturn(Optional.empty());
            assertThatThrownBy(() -> siteService.getById(USER_ID, SITE_ID))
                    .isInstanceOf(ResourceNotFoundException.class);
        }
    }

    @Nested @DisplayName("创建与更新")
    class CreateUpdate {
        @Test @DisplayName("create 成功后返回网站")
        void shouldCreateSite() {
            when(categoryRepository.existsByIdAndUserId(CATEGORY_ID, USER_ID)).thenReturn(true);
            when(siteRepository.save(any(Site.class))).thenReturn(createSite());
            var result = siteService.create(USER_ID, CATEGORY_ID, "测试", "https://ex.com", null, 60, true);
            assertThat(result).isNotNull();
        }

        @Test @DisplayName("create 分类不属当前用户抛异常")
        void shouldThrowWhenCategoryNotOwned() {
            when(categoryRepository.existsByIdAndUserId(CATEGORY_ID, USER_ID)).thenReturn(false);
            assertThatThrownBy(() -> siteService.create(USER_ID, CATEGORY_ID, "测试", "https://ex.com", null, null, null))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test @DisplayName("update 更新字段")
        void shouldUpdateFields() {
            var existing = createSite();
            existing.setName("旧名称");
            when(siteRepository.findByIdAndUserId(SITE_ID, USER_ID)).thenReturn(Optional.of(existing));
            when(siteRepository.save(any(Site.class))).thenAnswer(i -> i.getArgument(0));
            var result = siteService.update(USER_ID, SITE_ID, null, "新名称", null, null, null, false);
            assertThat(result.getName()).isEqualTo("新名称");
            assertThat(result.getEnabled()).isFalse();
        }
    }

    @Nested @DisplayName("删除")
    class Delete {
        @Test @DisplayName("delete 删除自己的网站")
        void shouldDeleteOwnSite() {
            when(siteRepository.findByIdAndUserId(SITE_ID, USER_ID)).thenReturn(Optional.of(createSite()));
            siteService.delete(USER_ID, SITE_ID);
            verify(siteRepository).delete(any(Site.class));
        }

        @Test @DisplayName("delete 他人网站抛异常")
        void shouldThrowWhenDeletingNotOwned() {
            when(siteRepository.findByIdAndUserId(SITE_ID, USER_ID)).thenReturn(Optional.empty());
            assertThatThrownBy(() -> siteService.delete(USER_ID, SITE_ID))
                    .isInstanceOf(ResourceNotFoundException.class);
        }
    }

    @Nested @DisplayName("失败追踪")
    class FailureTracking {
        @Test @DisplayName("recordFailure 递增失败计数")
        void shouldRecordFailure() {
            var site = createSite();
            site.setConsecutiveFailures(2);
            OffsetDateTime nextRetryAt = OffsetDateTime.now().plusMinutes(5);
            when(siteRepository.findById(SITE_ID)).thenReturn(Optional.of(site));
            when(siteRepository.save(any(Site.class))).thenAnswer(i -> i.getArgument(0));
            siteService.recordFailure(SITE_ID, "连接超时", nextRetryAt);
            assertThat(site.getConsecutiveFailures()).isEqualTo(3);
            assertThat(site.getLastFailureReason()).isEqualTo("连接超时");
            assertThat(site.getNextRetryAt()).isEqualTo(nextRetryAt);
        }

        @Test @DisplayName("resetFailureCount 清零")
        void shouldResetFailureCount() {
            var site = createSite();
            site.setConsecutiveFailures(5);
            site.setNextRetryAt(OffsetDateTime.now().plusMinutes(15));
            when(siteRepository.findById(SITE_ID)).thenReturn(Optional.of(site));
            when(siteRepository.save(any(Site.class))).thenAnswer(i -> i.getArgument(0));
            siteService.resetFailureCount(SITE_ID);
            assertThat(site.getConsecutiveFailures()).isZero();
            assertThat(site.getNextRetryAt()).isNull();
        }

        @Test @DisplayName("recordFailure null 字段处理")
        void shouldHandleNullConsecutive() {
            var site = createSite();
            site.setConsecutiveFailures(null);
            when(siteRepository.findById(SITE_ID)).thenReturn(Optional.of(site));
            when(siteRepository.save(any(Site.class))).thenAnswer(i -> i.getArgument(0));
            siteService.recordFailure(SITE_ID, "错误");
            assertThat(site.getConsecutiveFailures()).isEqualTo(1);
        }

        @Test @DisplayName("recordSuccess 写入最后成功时间并清理失败状态")
        void shouldRecordSuccessAndClearFailureState() {
            var site = createSite();
            site.setConsecutiveFailures(2);
            site.setLastFailureReason("RSS 解析失败");
            site.setLastFailureAt(OffsetDateTime.now().minusMinutes(1));
            site.setNextRetryAt(OffsetDateTime.now().plusMinutes(5));
            when(siteRepository.findById(SITE_ID)).thenReturn(Optional.of(site));
            when(siteRepository.save(any(Site.class))).thenAnswer(i -> i.getArgument(0));

            siteService.recordSuccess(SITE_ID);

            assertThat(site.getConsecutiveFailures()).isZero();
            assertThat(site.getLastFailureReason()).isNull();
            assertThat(site.getLastFailureAt()).isNull();
            assertThat(site.getNextRetryAt()).isNull();
            assertThat(site.getLastSuccessAt()).isNotNull();
        }
    }

    private Site createSite() {
        var site = new Site();
        site.setId(SITE_ID);
        site.setUserId(USER_ID);
        site.setCategoryId(CATEGORY_ID);
        site.setName("测试站点");
        site.setUrl("https://example.com");
        site.setCollectionIntervalMinutes(1440);
        site.setEnabled(true);
        site.setCreatedAt(OffsetDateTime.now());
        site.setUpdatedAt(OffsetDateTime.now());
        return site;
    }
}
