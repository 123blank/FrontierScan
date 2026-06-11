package com.frontierscan.security;

import com.frontierscan.article.Article;
import com.frontierscan.article.ArticleRepository;
import com.frontierscan.article.ArticleService;
import com.frontierscan.article.FavoriteRepository;
import com.frontierscan.auth.UserAccount;
import com.frontierscan.auth.UserAccountRepository;
import com.frontierscan.category.Category;
import com.frontierscan.category.CategoryRepository;
import com.frontierscan.category.CategoryService;
import com.frontierscan.common.error.ResourceNotFoundException;
import com.frontierscan.site.Site;
import com.frontierscan.site.SiteRepository;
import com.frontierscan.site.SiteService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用户数据隔离集成测试。
 * <p>
 * <b>测试目标：</b>验证分类、网站、文章和收藏等用户私有资源在 Service 层强制绑定
 * {@code userId}，任意按 ID 访问、更新、删除或关联其他用户资源时都应失败。
 * 该测试使用真实 Spring 上下文和 H2 数据库，覆盖 Repository 派生查询与 Service 业务校验的组合行为。
 * </p>
 *
 * <p><b>安全约定：</b>资源不存在和资源不属于当前用户统一抛出
 * {@link ResourceNotFoundException}，对外表现为 404，避免通过 ID 探测其他用户数据。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@DisplayName("用户数据隔离集成测试")
class UserDataIsolationIntegrationTest {

    @Autowired
    private CategoryService categoryService;

    @Autowired
    private SiteService siteService;

    @Autowired
    private ArticleService articleService;

    @Autowired
    private UserAccountRepository userRepository;

    @Autowired
    private CategoryRepository categoryRepository;

    @Autowired
    private SiteRepository siteRepository;

    @Autowired
    private ArticleRepository articleRepository;

    @Autowired
    private FavoriteRepository favoriteRepository;

    private UserAccount owner;
    private UserAccount intruder;
    private Category ownerCategory;
    private Category intruderCategory;
    private Site ownerSite;
    private Article ownerArticle;

    @BeforeEach
    void setUp() {
        favoriteRepository.deleteAll();
        articleRepository.deleteAll();
        siteRepository.deleteAll();
        categoryRepository.deleteAll();
        userRepository.deleteAll();

        owner = userRepository.save(createUser("owner-user"));
        intruder = userRepository.save(createUser("intruder-user"));
        ownerCategory = categoryRepository.save(createCategory(owner.getId(), "Owner 分类"));
        intruderCategory = categoryRepository.save(createCategory(intruder.getId(), "Intruder 分类"));
        ownerSite = siteRepository.save(createSite(owner.getId(), ownerCategory.getId(), "Owner 站点"));
        ownerArticle = articleRepository.save(createArticle(owner.getId(), ownerSite.getId(), ownerCategory.getId()));
    }

    @Nested
    @DisplayName("分类隔离")
    class CategoryIsolation {

        @Test
        @DisplayName("用户不能读取其他用户的分类详情")
        void shouldRejectReadingOtherUsersCategory() {
            assertThatThrownBy(() -> categoryService.getById(intruder.getId(), ownerCategory.getId()))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test
        @DisplayName("用户不能更新其他用户的分类")
        void shouldRejectUpdatingOtherUsersCategory() {
            assertThatThrownBy(() -> categoryService.update(
                    intruder.getId(), ownerCategory.getId(), "非法更新", null, null, null))
                    .isInstanceOf(ResourceNotFoundException.class);

            assertThat(categoryRepository.findById(ownerCategory.getId()).orElseThrow().getName())
                    .isEqualTo("Owner 分类");
        }

        @Test
        @DisplayName("用户不能删除其他用户的分类")
        void shouldRejectDeletingOtherUsersCategory() {
            assertThatThrownBy(() -> categoryService.delete(intruder.getId(), ownerCategory.getId()))
                    .isInstanceOf(ResourceNotFoundException.class);

            assertThat(categoryRepository.findById(ownerCategory.getId())).isPresent();
        }
    }

    @Nested
    @DisplayName("网站隔离")
    class SiteIsolation {

        @Test
        @DisplayName("用户只能查询自己添加的网站")
        void shouldOnlyListOwnSites() {
            assertThat(siteService.listByUser(owner.getId(), null))
                    .extracting(Site::getId)
                    .containsExactly(ownerSite.getId());
            assertThat(siteService.listByUser(intruder.getId(), null)).isEmpty();
        }

        @Test
        @DisplayName("用户不能读取其他用户的网站详情")
        void shouldRejectReadingOtherUsersSite() {
            assertThatThrownBy(() -> siteService.getById(intruder.getId(), ownerSite.getId()))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test
        @DisplayName("用户不能更新其他用户的网站")
        void shouldRejectUpdatingOtherUsersSite() {
            assertThatThrownBy(() -> siteService.update(
                    intruder.getId(), ownerSite.getId(), intruderCategory.getId(),
                    "非法站点", null, null, null, null))
                    .isInstanceOf(ResourceNotFoundException.class);

            assertThat(siteRepository.findById(ownerSite.getId()).orElseThrow().getName())
                    .isEqualTo("Owner 站点");
        }

        @Test
        @DisplayName("用户创建网站时不能挂载其他用户的分类")
        void shouldRejectCreatingSiteWithOtherUsersCategory() {
            assertThatThrownBy(() -> siteService.create(
                    intruder.getId(), ownerCategory.getId(), "非法挂载", "https://evil.example",
                    null, 1440, true))
                    .isInstanceOf(ResourceNotFoundException.class);
        }
    }

    @Nested
    @DisplayName("文章和收藏隔离")
    class ArticleIsolation {

        @Test
        @DisplayName("用户不能读取其他用户采集到的文章详情")
        void shouldRejectReadingOtherUsersArticle() {
            assertThatThrownBy(() -> articleService.getById(intruder.getId(), ownerArticle.getId()))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test
        @DisplayName("用户不能收藏其他用户的文章")
        void shouldRejectFavoritingOtherUsersArticle() {
            assertThatThrownBy(() -> articleService.toggleFavorite(intruder.getId(), ownerArticle.getId()))
                    .isInstanceOf(ResourceNotFoundException.class);

            assertThat(favoriteRepository.existsByUserIdAndArticleId(intruder.getId(), ownerArticle.getId()))
                    .isFalse();
        }

        @Test
        @DisplayName("用户只能统计到自己的文章数量")
        void shouldOnlyCountOwnArticles() {
            assertThat(articleService.countByUser(owner.getId())).isEqualTo(1);
            assertThat(articleService.countByUser(intruder.getId())).isZero();
        }
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
        category.setDescription("隔离测试分类");
        category.setSortOrder(0);
        category.setArchived(false);
        category.setCreatedAt(OffsetDateTime.now());
        category.setUpdatedAt(OffsetDateTime.now());
        return category;
    }

    /** 创建测试网站。 */
    private Site createSite(Long userId, Long categoryId, String name) {
        Site site = new Site();
        site.setUserId(userId);
        site.setCategoryId(categoryId);
        site.setName(name);
        site.setUrl("https://example.com/" + name);
        site.setRssUrl("https://example.com/rss.xml");
        site.setCollectionIntervalMinutes(1440);
        site.setEnabled(true);
        site.setCreatedAt(OffsetDateTime.now());
        site.setUpdatedAt(OffsetDateTime.now());
        return site;
    }

    /** 创建测试文章。 */
    private Article createArticle(Long userId, Long siteId, Long categoryId) {
        Article article = new Article();
        article.setUserId(userId);
        article.setSiteId(siteId);
        article.setCategoryId(categoryId);
        article.setTitle("Owner 私有文章");
        article.setSourceUrl("https://example.com/article");
        article.setSourceHash("hash-" + userId + "-" + siteId);
        article.setContentExcerpt("隔离测试正文");
        article.setCollectedAt(OffsetDateTime.now());
        article.setCreatedAt(OffsetDateTime.now());
        return article;
    }
}
