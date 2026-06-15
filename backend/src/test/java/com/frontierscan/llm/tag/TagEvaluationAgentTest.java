package com.frontierscan.llm.tag;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.frontierscan.llm.tag.mapper.ArticleTagMappingMapper;
import com.frontierscan.llm.tag.mapper.TagDomainMapper;
import com.frontierscan.llm.tag.mp.ArticleTagMappingPo;
import com.frontierscan.llm.tag.mp.TagDomainPo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.OffsetDateTime;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link TagEvaluationAgent} 标签持久化单元测试。
 * <p>
 * 该测试锁定 MyBatis-Plus 试点的核心行为：标签评估成功后必须先清理旧关联，再写入本轮结构化标签，
 * 并同步更新 {@code articles.tags} 兜底展示字段。
 * </p>
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("TagEvaluationAgent 标签持久化")
class TagEvaluationAgentTest {

    @Mock
    private TagDomainMapper tagDomainMapper;
    @Mock
    private ArticleTagMappingMapper articleTagMappingMapper;
    @Mock
    private DomainClassifier domainClassifier;
    @Mock
    private LlmTagScorer llmTagScorer;
    @Mock
    private JdbcTemplate jdbcTemplate;

    private TagEvaluationAgent agent;

    @BeforeEach
    void setUp() {
        agent = new TagEvaluationAgent(
                tagDomainMapper,
                articleTagMappingMapper,
                domainClassifier,
                llmTagScorer,
                jdbcTemplate);
    }

    @Test
    @DisplayName("评估成功后覆盖旧标签关联并同步文章标签字段")
    void shouldReplaceOldMappingsAndSyncArticleTags() {
        TagDomainPo domain = new TagDomainPo();
        domain.setId(1L);
        domain.setName("科技");
        domain.setTableName("tech_tags");
        domain.setCreatedAt(OffsetDateTime.now());
        when(tagDomainMapper.selectList(null)).thenReturn(List.of(domain));
        when(domainClassifier.classify(any(), eq("标题"), anyString()))
                .thenReturn(List.of(new ScoredDomain("科技", 9)));
        when(jdbcTemplate.query(eq("SELECT id, name FROM tech_tags ORDER BY id"), any(org.springframework.jdbc.core.RowMapper.class)))
                .thenReturn(List.of(new TagInfo(10L, "人工智能"), new TagInfo(11L, "大模型")));
        when(llmTagScorer.scoreTags(any(), eq("标题"), anyString()))
                .thenReturn(List.of(new ScoredTag("人工智能", 10), new ScoredTag("大模型", 9)));

        List<ScoredTag> result = agent.evaluate(100L, "标题", "摘要 + 正文");

        assertThat(result).extracting(ScoredTag::tagName).containsExactly("人工智能", "大模型");
        verify(articleTagMappingMapper).delete(any(Wrapper.class));
        ArgumentCaptor<ArticleTagMappingPo> captor = ArgumentCaptor.forClass(ArticleTagMappingPo.class);
        verify(articleTagMappingMapper, org.mockito.Mockito.times(2)).insert(captor.capture());
        assertThat(captor.getAllValues()).extracting(ArticleTagMappingPo::getTagId).containsExactly(10L, 11L);
        assertThat(captor.getAllValues()).extracting(ArticleTagMappingPo::getTagDomain).containsOnly("科技");
        verify(jdbcTemplate).update("UPDATE articles SET tags = ? WHERE id = ?", "人工智能,大模型", 100L);
    }
}
