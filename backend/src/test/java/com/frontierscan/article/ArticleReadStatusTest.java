package com.frontierscan.article;

import com.frontierscan.common.error.ResourceNotFoundException;
import com.frontierscan.llm.LlmProperties;
import com.frontierscan.llm.tag.TagEvaluationAgent;
import com.frontierscan.llm.tag.mapper.ArticleTagMappingMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ArticleReadStatusTest {

    @Mock
    private ArticleRepository articleRepository;
    @Mock
    private FavoriteRepository favoriteRepository;
    @Mock
    private TagEvaluationAgent tagEvaluationAgent;
    @Mock
    private ArticleTagMappingMapper articleTagMappingMapper;

    private ArticleService articleService;

    @BeforeEach
    void setUp() {
        articleService = new ArticleService(articleRepository, favoriteRepository,
                tagEvaluationAgent, articleTagMappingMapper,
                new LlmProperties(null, null, null, null, null, null));
    }

    @Test
    void shouldMarkOwnedArticleAsRead() {
        Article article = article(1L);
        assertThat(article.getReadAt()).isNull();
        when(articleRepository.findById(10L)).thenReturn(Optional.of(article));
        when(articleRepository.save(article)).thenReturn(article);
        OffsetDateTime before = OffsetDateTime.now();

        Article result = articleService.markAsRead(1L, 10L);

        assertThat(result.getReadAt()).isAfterOrEqualTo(before);
        verify(articleRepository).save(article);
    }

    @Test
    void shouldKeepOriginalReadTimeWhenMarkedAsReadAgain() {
        Article article = article(1L);
        OffsetDateTime originalReadAt = OffsetDateTime.now().minusDays(1);
        article.setReadAt(originalReadAt);
        when(articleRepository.findById(10L)).thenReturn(Optional.of(article));
        when(articleRepository.save(article)).thenReturn(article);

        Article result = articleService.markAsRead(1L, 10L);

        assertThat(result.getReadAt()).isEqualTo(originalReadAt);
    }

    @Test
    void shouldMarkOwnedArticleAsUnread() {
        Article article = article(1L);
        article.setReadAt(OffsetDateTime.now());
        when(articleRepository.findById(10L)).thenReturn(Optional.of(article));
        when(articleRepository.save(article)).thenReturn(article);

        Article result = articleService.markAsUnread(1L, 10L);

        assertThat(result.getReadAt()).isNull();
        verify(articleRepository).save(article);
    }

    @Test
    void shouldRejectChangingOtherUsersReadStatus() {
        when(articleRepository.findById(10L)).thenReturn(Optional.of(article(2L)));

        assertThatThrownBy(() -> articleService.markAsRead(1L, 10L))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> articleService.markAsUnread(1L, 10L))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    private static Article article(Long userId) {
        Article article = new Article();
        article.setId(10L);
        article.setUserId(userId);
        return article;
    }
}
