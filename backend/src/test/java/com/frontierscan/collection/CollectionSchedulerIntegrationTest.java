package com.frontierscan.collection;

import com.frontierscan.auth.UserAccount;
import com.frontierscan.auth.UserAccountRepository;
import com.frontierscan.category.Category;
import com.frontierscan.category.CategoryRepository;
import com.frontierscan.site.Site;
import com.frontierscan.site.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.OffsetDateTime;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link CollectionScheduler} 定时调度集成测试。
 * <p>
 * <b>测试策略：</b>使用 {@code @SpringBootTest} 加载真实 Spring 上下文和 H2 数据库，
 * 验证调度器 Bean、配置属性绑定、JPA 派生查询方法、任务落库与异步编排投递的协作链路。
 * 采集编排器使用 {@code @MockBean} 替代，避免测试发起真实网络采集或 LLM 调用。
 * </p>
 *
 * <p><b>与单元测试的边界：</b>单元测试覆盖锁和防重的细分分支；本集成测试关注组件装配和数据库行为。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "app.collection.scheduler-enabled=true",
        "app.collection.scheduler-fixed-delay-ms=600000",
        "app.collection.lock-ttl-minutes=5"
})
@DisplayName("CollectionScheduler 定时调度集成测试")
class CollectionSchedulerIntegrationTest {

    /** 使用 Mock 编排器隔离真实采集链路，只验证调度是否正确投递任务。 */
    @MockBean
    private CollectionOrchestrator collectionOrchestrator;

    @Autowired
    private CollectionScheduler scheduler;

    @Autowired
    private CollectionScheduleProperties scheduleProperties;

    @Autowired
    private CollectionRunRepository collectionRunRepository;

    @Autowired
    private SiteRepository siteRepository;

    @Autowired
    private CategoryRepository categoryRepository;

    @Autowired
    private UserAccountRepository userRepository;

    private UserAccount testUser;
    private Category testCategory;
    private Site dueSite;

    @BeforeEach
    void setUp() {
        collectionRunRepository.deleteAll();
        siteRepository.deleteAll();
        categoryRepository.deleteAll();
        userRepository.deleteAll();

        testUser = userRepository.save(createUser("scheduler-user"));
        testCategory = categoryRepository.save(createCategory(testUser.getId(), "调度分类"));
        dueSite = siteRepository.save(createSite(testUser.getId(), testCategory.getId()));

        when(collectionOrchestrator.executeCollection(anyLong(), anyLong(), anyLong()))
                .thenAnswer(invocation -> CompletableFuture.completedFuture(invocation.getArgument(2)));
    }

    @Test
    @DisplayName("配置属性应正确绑定到 CollectionScheduleProperties")
    void shouldBindScheduleProperties() {
        assertThat(scheduleProperties.schedulerEnabled()).isTrue();
        assertThat(scheduleProperties.schedulerFixedDelayMs()).isEqualTo(600_000L);
        assertThat(scheduleProperties.lockTtlMinutes()).isEqualTo(5L);
    }

    @Test
    @DisplayName("扫描到期启用站点时，应落库 SCHEDULED 任务并投递采集编排器")
    void shouldCreateScheduledRunAndDispatchCollection() {
        scheduler.scheduleDueCollections();

        CollectionRun run = collectionRunRepository.findByUserIdAndSiteIdOrderByStartedAtDesc(
                testUser.getId(), dueSite.getId()).get(0);

        assertThat(run.getRunType()).isEqualTo("SCHEDULED");
        assertThat(run.getStatus()).isEqualTo("RUNNING");
        assertThat(run.getStartedAt()).isNotNull();
        verify(collectionOrchestrator).executeCollection(testUser.getId(), dueSite.getId(), run.getId());
    }

    @Test
    @DisplayName("站点未启用时，不应创建调度任务")
    void shouldSkipDisabledSites() {
        dueSite.setEnabled(false);
        siteRepository.save(dueSite);

        scheduler.scheduleDueCollections();

        assertThat(collectionRunRepository.findByUserIdOrderByStartedAtDesc(testUser.getId())).isEmpty();
    }

    /** 创建测试用户。 */
    private UserAccount createUser(String username) {
        UserAccount user = new UserAccount();
        user.setUsername(username);
        user.setPasswordHash("hash");
        user.setRole("USER");
        user.setStatus("ACTIVE");
        user.setCreatedAt(OffsetDateTime.now());
        user.setUpdatedAt(OffsetDateTime.now());
        return user;
    }

    /** 创建测试分类。 */
    private Category createCategory(Long userId, String name) {
        Category category = new Category();
        category.setUserId(userId);
        category.setName(name);
        category.setDescription("定时调度集成测试分类");
        category.setSortOrder(0);
        category.setArchived(false);
        category.setCreatedAt(OffsetDateTime.now());
        category.setUpdatedAt(OffsetDateTime.now());
        return category;
    }

    /** 创建立即到期的启用测试站点。 */
    private Site createSite(Long userId, Long categoryId) {
        Site site = new Site();
        site.setUserId(userId);
        site.setCategoryId(categoryId);
        site.setName("调度集成测试站点");
        site.setUrl("https://example.com");
        site.setRssUrl("https://example.com/rss");
        site.setCollectionIntervalMinutes(1);
        site.setEnabled(true);
        site.setCreatedAt(OffsetDateTime.now());
        site.setUpdatedAt(OffsetDateTime.now());
        return site;
    }
}
