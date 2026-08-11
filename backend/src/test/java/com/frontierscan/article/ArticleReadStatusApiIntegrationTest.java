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
    private String ownerToken;
    private String intruderToken;

    @BeforeEach
    void setUp() {
        favoriteRepository.deleteAll();
        articleRepository.deleteAll();
        userRepository.deleteAll();

        UserAccount owner = userRepository.save(user("read-owner"));
        UserAccount intruder = userRepository.save(user("read-intruder"));
        article = articleRepository.save(article(owner.getId()));
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

    private static Article article(Long userId) {
        Article article = new Article();
        article.setUserId(userId);
        article.setSiteId(1L);
        article.setCategoryId(1L);
        article.setTitle("阅读状态 API 测试文章");
        article.setSourceUrl("https://example.com/read-status");
        article.setSourceHash("read-status-" + userId);
        article.setCollectedAt(OffsetDateTime.now());
        article.setCreatedAt(OffsetDateTime.now());
        return article;
    }
}
