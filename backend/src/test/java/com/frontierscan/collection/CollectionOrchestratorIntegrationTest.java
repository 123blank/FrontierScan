package com.frontierscan.collection;

import com.frontierscan.article.ArticleRepository;
import com.frontierscan.article.ArticleSummaryStatus;
import com.frontierscan.auth.UserAccount;
import com.frontierscan.auth.UserAccountRepository;
import com.frontierscan.category.Category;
import com.frontierscan.category.CategoryRepository;
import com.frontierscan.llm.LlmProvider;
import com.frontierscan.llm.SummaryResult;
import com.frontierscan.site.Site;
import com.frontierscan.site.SiteRepository;
import com.frontierscan.site.SiteService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link CollectionOrchestrator} 采集编排集成测试。
 * <p>
 * <b>测试策略：</b>使用 {@code @SpringBootTest} 加载完整 Spring 上下文，
 * 通过 {@code test} Profile 启用 H2 内存数据库替代 PostgreSQL。
 * 采集器（RssCollector / HtmlCollector）和 SiteService 使用 Mockito Mock 替代，
 * 避免对外部网络和数据库的依赖。ArticleService 和 CollectionRunService 使用真实 JPA 实现。
 * </p>
 *
 * <p><b>测试范围：</b>
 * <ul>
 *   <li>采集成功场景：正常采集、空结果、去重</li>
 *   <li>异常处理场景：RSS 失败降级、连接超时标记</li>
 *   <li>用户隔离场景：不同用户的文章数据互不可见</li>
 * </ul>
 * </p>
 *
 * <p><b>数据清理：</b>每个 {@code @BeforeEach} 清空所有测试表，
 * 确保测试间无数据污染。测试数据通过私有工厂方法创建。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@DisplayName("CollectionOrchestrator 采集编排集成测试")
class CollectionOrchestratorIntegrationTest {

    // ===== Mock 组件（代替真实采集器和外部服务） =====

    /** RssCollector Mock：返回预设的 CollectResult，不发起真实 HTTP 请求。 */
    @MockBean
    private RssCollector rssCollector;

    /** HtmlCollector Mock：用于测试 RSS 降级到 HTML 的场景。 */
    @MockBean
    private HtmlCollector htmlCollector;

    /** SiteService Mock：返回预设的 Site 对象，不查询数据库。 */
    @MockBean
    private SiteService siteService;

    /** LLM Provider Mock：避免测试调用真实大模型服务。 */
    @MockBean
    private LlmProvider llmProvider;

    /** 标签评估 Mock：采集编排测试默认不依赖真实标签 LLM，单独验证触发和告警合并。 */
    @MockBean
    private TagEvaluationAsyncService tagEvaluationAsyncService;

    // ===== 注入真实组件 =====

    @Autowired
    private CollectionOrchestrator orchestrator;

    @Autowired
    private CollectionRunService collectionRunService;

    @Autowired
    private CollectionRunRepository collectionRunRepository;

    @Autowired
    private ArticleRepository articleRepository;

    @Autowired
    private UserAccountRepository userRepository;

    @Autowired
    private SiteRepository siteRepository;

    @Autowired
    private CategoryRepository categoryRepository;

    // ===== 测试数据 =====
    private UserAccount testUser;
    private Category testCategory;
    private Site testSite;

    @BeforeEach
    void setUp() {
        // 清空所有表，确保测试隔离
        articleRepository.deleteAll();
        collectionRunRepository.deleteAll();
        siteRepository.deleteAll();
        categoryRepository.deleteAll();
        userRepository.deleteAll();

        testUser = userRepository.save(createUser("test-user"));
        testCategory = categoryRepository.save(createCategory(testUser.getId(), "测试分类"));
        testSite = siteRepository.save(createSite(testUser, testCategory));

        when(siteService.getById(testUser.getId(), testSite.getId())).thenReturn(testSite);
        when(tagEvaluationAsyncService.evaluateArticleAsync(any()))
                .thenReturn(CompletableFuture.completedFuture(true));
    }

    /**
     * 创建模拟 RSS 采集结果。
     *
     * @param count 模拟采集的文章数量
     * @return 模拟的 {@link CollectResult}
     */
    private CollectResult mockRssResult(int count) {
        List<CollectResult.RawArticle> articles = IntStream.range(0, count)
                .mapToObj(i -> CollectResult.RawArticle.builder()
                        .title("测试文章 #" + (i + 1))
                        .sourceUrl("https://example.com/a/" + (i + 1))
                        .contentExcerpt("正文摘要 #" + (i + 1))
                        .sourceHash(ArticleParser.generateSourceHash("https://example.com/a/" + (i + 1)))
                        .publishedAt(Instant.now())
                        .build())
                .toList();
        return CollectResult.builder()
                .sourceType("RSS").rawArticles(articles)
                .collectedAt(Instant.now()).fetchDuration(100).parseCount(count)
                .build();
    }

    // ==================== 采集成功场景 ====================

    @Nested @DisplayName("✅ 采集成功场景")
    class Success {

        @Test @DisplayName("成功采集 3 篇 → 任务标记 COMPLETED，collectedCount=3，finishedAt 非空")
        void shouldSaveArticlesAndCompleteRun() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(mockRssResult(3));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            Long runId = orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                    .get(30, TimeUnit.SECONDS);

            CollectionRun done = collectionRunRepository.findById(runId).orElseThrow();
            assertThat(done.getStatus()).isEqualTo("COMPLETED");
            assertThat(done.getCollectedCount()).isEqualTo(3);
            assertThat(done.getFinishedAt()).isNotNull();
            assertThat(articleRepository.findByUserIdOrderByCollectedAtDesc(testUser.getId(), PageRequest.of(0, 10)))
                    .isNotEmpty();
            verify(siteService).recordSuccess(testSite.getId());
            verify(tagEvaluationAsyncService, times(3)).evaluateArticleAsync(any());
        }

        @Test @DisplayName("候选文章已存在（去重后新增 0 篇）→ COMPLETED，collectedCount=0")
        void duplicateCandidateShouldCompleteWithZeroNewArticles() throws Exception {
            CollectResult result = mockRssResult(1);
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(result);

            CollectionRun firstRun = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            orchestrator.executeCollection(testUser.getId(), testSite.getId(), firstRun.getId())
                    .get(30, TimeUnit.SECONDS);

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            Long runId = orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                    .get(30, TimeUnit.SECONDS);

            assertThat(collectionRunRepository.findById(runId).orElseThrow().getStatus()).isEqualTo("COMPLETED");
            assertThat(collectionRunRepository.findById(runId).orElseThrow().getCollectedCount()).isZero();
        }

        @Test @DisplayName("LLM 摘要失败 → 任务仍 COMPLETED，并记录 warningMessage")
        void llmFailureShouldCompleteWithWarning() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(mockRssResult(2));
            when(llmProvider.summarize(any())).thenThrow(new RuntimeException("llm down"));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            Long runId = orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                    .get(30, TimeUnit.SECONDS);

            CollectionRun done = collectionRunRepository.findById(runId).orElseThrow();
            assertThat(done.getStatus()).isEqualTo("COMPLETED");
            assertThat(done.getWarningMessage()).contains(CollectionFailureClassifier.LLM_SUMMARY_FAILED);
            verify(siteService).recordSuccess(testSite.getId());
            verify(siteService, never()).recordFailure(any(), any(), any());
        }

        @Test @DisplayName("LLM 返回低质量摘要时，采集任务仍 COMPLETED，文章状态为 LOW_QUALITY")
        void llmLowQualityShouldComplete() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(mockRssResult(1));
            when(llmProvider.summarize(any())).thenReturn(new SummaryResult(
                    "治理标题",
                    "摘要过短。",
                    List.of("要点1"),
                    List.of()));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            Long runId = orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                    .get(30, TimeUnit.SECONDS);

            CollectionRun done = collectionRunRepository.findById(runId).orElseThrow();
            assertThat(done.getStatus()).isEqualTo("COMPLETED");
            assertThat(done.getWarningMessage()).isNull();
            assertThat(articleRepository.findByUserIdOrderByCollectedAtDesc(testUser.getId(), PageRequest.of(0, 10))
                    .getContent().get(0).getSummaryStatus()).isEqualTo(ArticleSummaryStatus.LOW_QUALITY);
        }

        @Test @DisplayName("LLM 失败时文章状态为 FAILED，但采集任务仍保持 COMPLETED")
        void llmFailedArticleShouldBeMarkedFailed() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(mockRssResult(1));
            when(llmProvider.summarize(any())).thenThrow(new RuntimeException("llm down"));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            Long runId = orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                    .get(30, TimeUnit.SECONDS);

            CollectionRun done = collectionRunRepository.findById(runId).orElseThrow();
            assertThat(done.getStatus()).isEqualTo("COMPLETED");
            assertThat(done.getWarningMessage()).contains(CollectionFailureClassifier.LLM_SUMMARY_FAILED);
            assertThat(articleRepository.findByUserIdOrderByCollectedAtDesc(testUser.getId(), PageRequest.of(0, 10))
                    .getContent().get(0).getSummaryStatus()).isEqualTo(ArticleSummaryStatus.FAILED);
        }

        @Test @DisplayName("重复采集相同数据 → 第二次 collectedCount=0（去重生效）")
        void tagFailureShouldCompleteWithWarning() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(mockRssResult(1));
            when(llmProvider.summarize(any())).thenReturn(new SummaryResult(
                    "标签标题",
                    "这是一段足够长的摘要内容，用于模拟摘要治理成功完成，然后标签评估返回非阻断告警，采集任务仍然应该完成。",
                    List.of("摘要完成", "标签失败"),
                    List.of("测试")));
            when(tagEvaluationAsyncService.evaluateArticleAsync(any()))
                    .thenReturn(CompletableFuture.completedFuture(false));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            Long runId = orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                    .get(30, TimeUnit.SECONDS);

            CollectionRun done = collectionRunRepository.findById(runId).orElseThrow();
            assertThat(done.getStatus()).isEqualTo("COMPLETED");
            assertThat(done.getWarningMessage()).contains(CollectionFailureClassifier.TAG_EVALUATION_FAILED);
            verify(siteService).recordSuccess(testSite.getId());
        }

        @Test @DisplayName("重复采集相同数据 → 第二次 collectedCount=0（去重生效）")
        void duplicateCollection() throws Exception {
            CollectResult result = mockRssResult(2);
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(result);

            CollectionRun r1 = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            orchestrator.executeCollection(testUser.getId(), testSite.getId(), r1.getId()).get(30, TimeUnit.SECONDS);

            CollectionRun r2 = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            orchestrator.executeCollection(testUser.getId(), testSite.getId(), r2.getId()).get(30, TimeUnit.SECONDS);

            assertThat(collectionRunRepository.findById(r2.getId()).orElseThrow().getCollectedCount()).isZero();
            assertThat(articleRepository.count()).isEqualTo(2);
        }
    }

    // ==================== 异常处理场景 ====================

    @Nested @DisplayName("⚠️ 异常处理场景")
    class Exceptions {

        @Test @DisplayName("RSS 采集失败 → 自动降级到 HTML 采集，最终 COMPLETED")
        void rssFallbackToHtml() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenThrow(
                    new ParseException("RSS", testSite.getRssUrl(), "解析失败"));
            when(htmlCollector.sourceType()).thenReturn("HTML");
            when(htmlCollector.collect(any())).thenReturn(mockRssResult(2));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            Long runId = orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                    .get(30, TimeUnit.SECONDS);

            assertThat(collectionRunRepository.findById(runId).orElseThrow().getStatus()).isEqualTo("COMPLETED");
            assertThat(collectionRunRepository.findById(runId).orElseThrow().getCollectedCount()).isEqualTo(2);
        }

        @Test @DisplayName("RSS 和 HTML 均失败 → 任务标记 FAILED，errorMessage 包含原因")
        void collectorException() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenThrow(
                    new ConnectionTimeoutException("RSS", testSite.getRssUrl(), "连接超时"));
            when(htmlCollector.sourceType()).thenReturn("HTML");
            when(htmlCollector.collect(any())).thenThrow(
                    new ConnectionTimeoutException("HTML", testSite.getUrl(), "HTML 也超时"));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            try {
                orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                        .get(30, TimeUnit.SECONDS);
            } catch (Exception ignored) {}

            CollectionRun failed = collectionRunRepository.findById(run.getId()).orElseThrow();
            assertThat(failed.getStatus()).isEqualTo("FAILED");
            assertThat(failed.getErrorMessage()).contains("超时");
            assertThat(failed.getFailureType()).isEqualTo(CollectionFailureClassifier.NETWORK_TIMEOUT);
            assertThat(failed.getFailureStage()).isEqualTo(CollectionFailureClassifier.STAGE_HTML);
            assertThat(failed.getNextRetryAt()).isNotNull();
            verify(siteService).recordFailure(eq(testSite.getId()), any(), any());
        }

        @Test @DisplayName("RSS 和 HTML 均解析不到候选文章 → EMPTY_RESULT 失败并设置重试")
        void emptyCandidatesShouldFailAndScheduleRetry() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(mockRssResult(0));
            when(htmlCollector.sourceType()).thenReturn("HTML");
            when(htmlCollector.collect(any())).thenReturn(mockRssResult(0));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            try {
                orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId())
                        .get(30, TimeUnit.SECONDS);
            } catch (Exception ignored) {}

            CollectionRun failed = collectionRunRepository.findById(run.getId()).orElseThrow();
            assertThat(failed.getStatus()).isEqualTo("FAILED");
            assertThat(failed.getFailureType()).isEqualTo(CollectionFailureClassifier.EMPTY_RESULT);
            assertThat(failed.getFailureStage()).isEqualTo(CollectionFailureClassifier.STAGE_HTML);
            assertThat(failed.getNextRetryAt()).isNotNull();
        }
    }

    // ==================== 用户数据隔离 ====================

    @Nested @DisplayName("🔒 用户数据隔离")
    class Isolation {

        @Test @DisplayName("用户A采集后，用户B查询不到用户A的文章")
        void dataIsolation() throws Exception {
            when(rssCollector.sourceType()).thenReturn("RSS");
            when(rssCollector.collect(any())).thenReturn(mockRssResult(2));

            CollectionRun run = collectionRunService.create(testUser.getId(), testSite.getId(), "MANUAL");
            orchestrator.executeCollection(testUser.getId(), testSite.getId(), run.getId()).get(30, TimeUnit.SECONDS);

            assertThat(articleRepository.countByUserId(testUser.getId())).isEqualTo(2);
            assertThat(articleRepository.countByUserId(999L)).isZero();
        }
    }

    // ==================== 测试数据工厂方法 ====================

    /** 创建指定用户名的测试用户。 */
    private UserAccount createUser(String name) {
        UserAccount u = new UserAccount();
        u.setUsername(name); u.setPasswordHash("hash"); u.setRole("USER");
        u.setStatus("ACTIVE"); u.setCreatedAt(OffsetDateTime.now()); u.setUpdatedAt(OffsetDateTime.now());
        return u;
    }

    /** 创建指定用户和名称的测试分类。 */
    private Category createCategory(Long userId, String name) {
        Category c = new Category();
        c.setUserId(userId); c.setName(name); c.setSortOrder(0);
        c.setArchived(false); c.setCreatedAt(OffsetDateTime.now()); c.setUpdatedAt(OffsetDateTime.now());
        return c;
    }

    /** 创建测试网站，关联到指定用户和分类。 */
    private Site createSite(UserAccount user, Category cat) {
        Site s = new Site();
        s.setUserId(user.getId()); s.setCategoryId(cat.getId());
        s.setName("测试站点"); s.setUrl("https://example.com");
        s.setRssUrl("https://example.com/rss"); s.setCollectionIntervalMinutes(1440);
        s.setEnabled(true); s.setCreatedAt(OffsetDateTime.now()); s.setUpdatedAt(OffsetDateTime.now());
        return s;
    }
}
