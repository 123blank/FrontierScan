package com.frontierscan.article;

import com.frontierscan.auth.UserAccount;
import com.frontierscan.auth.UserAccountRepository;
import com.frontierscan.common.security.JwtUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.OffsetDateTime;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ArticleReadStatusApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JwtUtil jwtUtil;
    @Autowired
    private UserAccountRepository userRepository;
    @Autowired
    private ArticleRepository articleRepository;
    @Autowired
    private FavoriteRepository favoriteRepository;

    private Article article;
    private Article readArticle;
    private String ownerToken;
    private String intruderToken;

    @BeforeEach
    void setUp() {
        favoriteRepository.deleteAll();
        articleRepository.deleteAll();
        userRepository.deleteAll();

        UserAccount owner = userRepository.save(user("read-owner"));
        UserAccount intruder = userRepository.save(user("read-intruder"));
        article = articleRepository.save(article(owner.getId(), "未读文章", null));
        readArticle = articleRepository.save(article(
                owner.getId(), "已读文章", OffsetDateTime.now().minusMinutes(5)));
        articleRepository.save(article(intruder.getId(), "其他用户未读文章", null));
        ownerToken = jwtUtil.generateToken(owner.getId(), owner.getUsername(), owner.getRole());
        intruderToken = jwtUtil.generateToken(intruder.getId(), intruder.getUsername(), intruder.getRole());
    }

    @Test
    void shouldRequireAuthentication() throws Exception {
        mockMvc.perform(put("/api/articles/{id}/read", article.getId()))
                .andExpect(status().isForbidden());
    }

    @Test
    void shouldMarkOwnedArticleAsReadAndUnread() throws Exception {
        mockMvc.perform(put("/api/articles/{id}/read", article.getId())
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(article.getId()))
                .andExpect(jsonPath("$.data.readAt").isNotEmpty());

        mockMvc.perform(delete("/api/articles/{id}/read", article.getId())
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(article.getId()))
                .andExpect(jsonPath("$.data.readAt").doesNotExist());
    }

    @Test
    void shouldReturnNotFoundForOtherUsersArticle() throws Exception {
        mockMvc.perform(put("/api/articles/{id}/read", article.getId())
                        .header("Authorization", "Bearer " + intruderToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @Test
    void shouldFilterUnreadArticlesForCurrentUser() throws Exception {
        mockMvc.perform(get("/api/articles")
                        .param("readStatus", "unread")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].id").value(article.getId()))
                .andExpect(jsonPath("$.data.content[0].readAt").doesNotExist());
    }

    @Test
    void shouldFilterReadArticlesForCurrentUser() throws Exception {
        mockMvc.perform(get("/api/articles")
                        .param("readStatus", "read")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.content[0].id").value(readArticle.getId()))
                .andExpect(jsonPath("$.data.content[0].readAt").isNotEmpty());
    }

    @Test
    void shouldKeepAllArticlesAsDefaultAndExplicitAll() throws Exception {
        mockMvc.perform(get("/api/articles")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2));

        mockMvc.perform(get("/api/articles")
                        .param("readStatus", "all")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2));
    }

    @Test
    void shouldCombineUnreadStatusWithExistingFiltersPaginationAndUserIsolation() throws Exception {
        UserAccount owner = userRepository.findByUsername("read-owner").orElseThrow();
        Article newerOwnerArticle = article(owner.getId(), "分页未读文章", null);
        newerOwnerArticle.setCollectedAt(OffsetDateTime.now().plusMinutes(1));
        newerOwnerArticle = articleRepository.save(newerOwnerArticle);

        UserAccount intruder = userRepository.findByUsername("read-intruder").orElseThrow();
        Article newerIntruderArticle = article(intruder.getId(), "分页未读文章", null);
        newerIntruderArticle.setCollectedAt(OffsetDateTime.now().plusMinutes(2));
        articleRepository.save(newerIntruderArticle);

        mockMvc.perform(get("/api/articles")
                        .param("readStatus", "unread")
                        .param("categoryId", "1")
                        .param("siteId", "1")
                        .param("keyword", "未读文章")
                        .param("page", "0")
                        .param("size", "1")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.totalPages").value(2))
                .andExpect(jsonPath("$.data.number").value(0))
                .andExpect(jsonPath("$.data.size").value(1))
                .andExpect(jsonPath("$.data.content.length()").value(1))
                .andExpect(jsonPath("$.data.content[0].id").value(newerOwnerArticle.getId()));
    }

    @Test
    void shouldRejectInvalidReadStatus() throws Exception {
        mockMvc.perform(get("/api/articles")
                        .param("readStatus", "unknown")
                        .header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    private static UserAccount user(String username) {
        UserAccount user = new UserAccount();
        user.setUsername(username);
        user.setPasswordHash("hash");
        user.setRole("USER");
        user.setStatus("ACTIVE");
        user.setCreatedAt(OffsetDateTime.now());
        user.setUpdatedAt(OffsetDateTime.now());
        return user;
    }

    private static Article article(Long userId, String title, OffsetDateTime readAt) {
        Article article = new Article();
        article.setUserId(userId);
        article.setSiteId(1L);
        article.setCategoryId(1L);
        article.setTitle(title);
        article.setSourceUrl("https://example.com/read-status/" + title);
        article.setSourceHash("read-status-" + userId + "-" + title);
        article.setReadAt(readAt);
        article.setCollectedAt(OffsetDateTime.now());
        article.setCreatedAt(OffsetDateTime.now());
        return article;
    }
}
