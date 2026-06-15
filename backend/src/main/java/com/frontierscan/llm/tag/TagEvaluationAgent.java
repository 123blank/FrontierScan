package com.frontierscan.llm.tag;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.frontierscan.llm.tag.mapper.ArticleTagMappingMapper;
import com.frontierscan.llm.tag.mapper.TagDomainMapper;
import com.frontierscan.llm.tag.mp.ArticleTagMappingPo;
import com.frontierscan.llm.tag.mp.TagDomainPo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 标签评估 Agent：完成领域分类、标签评分和文章标签落库。
 * <p>
 * 本期将标签模块作为 MyBatis-Plus 试点：领域路由表 {@code tag_domains} 和文章标签关联表
 * {@code article_tags} 通过 MP Mapper 访问；动态领域标签表仍通过受控的 {@link JdbcTemplate}
 * 查询，因为表名来自 {@code tag_domains.table_name}，不适合绑定成固定 Mapper。
 * </p>
 *
 * <p>
 * 标签评估不属于采集主链路的硬性成功条件。调用方会捕获异常并记录告警，避免 LLM 标签波动导致文章采集失败。
 * </p>
 */
@Slf4j
@Component
public class TagEvaluationAgent {

    private static final int MAX_DOMAINS = 3;
    private static final int MAX_TAGS = 3;

    private final TagDomainMapper tagDomainMapper;
    private final ArticleTagMappingMapper articleTagMappingMapper;
    private final DomainClassifier domainClassifier;
    private final LlmTagScorer llmTagScorer;
    private final JdbcTemplate jdbcTemplate;

    public TagEvaluationAgent(TagDomainMapper tagDomainMapper,
                              ArticleTagMappingMapper articleTagMappingMapper,
                              DomainClassifier domainClassifier,
                              LlmTagScorer llmTagScorer,
                              JdbcTemplate jdbcTemplate) {
        this.tagDomainMapper = tagDomainMapper;
        this.articleTagMappingMapper = articleTagMappingMapper;
        this.domainClassifier = domainClassifier;
        this.llmTagScorer = llmTagScorer;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 对文章执行完整标签评估流程。
     *
     * @param articleId 文章 ID
     * @param title     文章标题
     * @param content   标签评估输入，推荐由摘要、关键要点和正文片段拼接而成
     * @return 本轮选中的标签；失败或无法评估时返回空列表
     */
    @Transactional
    public List<ScoredTag> evaluate(Long articleId, String title, String content) {
        List<TagDomainPo> domainRows = tagDomainMapper.selectList(null);
        if (domainRows.isEmpty()) {
            log.warn("No tag domains configured; skipping tag evaluation for article {}", articleId);
            return List.of();
        }

        List<TagDomain> classifierDomains = domainRows.stream()
                .map(TagEvaluationAgent::toDomainEntity)
                .toList();
        Map<String, TagDomainPo> domainByName = domainRows.stream()
                .collect(Collectors.toMap(TagDomainPo::getName, row -> row, (a, b) -> a, LinkedHashMap::new));

        List<ScoredDomain> scoredDomains = domainClassifier.classify(classifierDomains, title, content);
        if (scoredDomains.isEmpty()) {
            log.debug("Domain classifier returned no results for article {}", articleId);
            return List.of();
        }

        List<ScoredDomain> topDomains = scoredDomains.stream()
                .sorted(Comparator.comparingInt(ScoredDomain::score).reversed())
                .limit(MAX_DOMAINS)
                .toList();

        List<TagInfo> candidateTags = new ArrayList<>();
        Map<String, CandidateTag> candidateByName = new HashMap<>();
        for (ScoredDomain scoredDomain : topDomains) {
            TagDomainPo domain = domainByName.get(scoredDomain.domain());
            if (domain == null) {
                log.warn("Domain '{}' not found in tag_domains table", scoredDomain.domain());
                continue;
            }
            List<TagInfo> tags = queryTagsFromTable(domain.getTableName());
            candidateTags.addAll(tags);
            for (TagInfo tag : tags) {
                candidateByName.putIfAbsent(tag.name(), new CandidateTag(tag.id(), tag.name(), domain.getName()));
            }
        }

        if (candidateTags.isEmpty()) {
            log.warn("No candidate tags found for article {}", articleId);
            return List.of();
        }

        List<ScoredTag> scoredTags = llmTagScorer.scoreTags(candidateTags, title, content);
        if (scoredTags.isEmpty()) {
            log.debug("Tag scorer returned no results for article {}", articleId);
            return List.of();
        }

        List<ScoredTag> topTags = scoredTags.stream()
                .sorted(Comparator.comparingInt(ScoredTag::score).reversed())
                .limit(MAX_TAGS)
                .toList();

        saveArticleTags(articleId, topTags, candidateByName);
        log.info("Tag evaluation complete for article {}: {}", articleId,
                topTags.stream().map(ScoredTag::tagName).collect(Collectors.joining(",")));
        return topTags;
    }

    /**
     * 从领域标签表读取候选标签。
     * <p>
     * 表名只能来自 {@code tag_domains.table_name}，不得使用外部请求参数拼接 SQL，避免动态表名成为 SQL 注入入口。
     * </p>
     */
    private List<TagInfo> queryTagsFromTable(String tableName) {
        String sql = "SELECT id, name FROM " + tableName + " ORDER BY id";
        try {
            return jdbcTemplate.query(sql, (rs, rowNum) ->
                    new TagInfo(rs.getLong("id"), rs.getString("name")));
        } catch (Exception e) {
            log.warn("Failed to query tag table '{}': {}", tableName, e.getMessage());
            return List.of();
        }
    }

    /**
     * 保存本轮标签评估结果。
     * <p>
     * 保存策略是先清理旧关联，再写入本轮结果，确保重摘要或重新评估后不会混用旧标签。
     * 同时同步更新 {@code articles.tags}，作为文章卡片展示和历史兼容的兜底字段。
     * </p>
     */
    private void saveArticleTags(Long articleId, List<ScoredTag> topTags, Map<String, CandidateTag> candidateByName) {
        articleTagMappingMapper.delete(new QueryWrapper<ArticleTagMappingPo>().eq("article_id", articleId));

        OffsetDateTime now = OffsetDateTime.now();
        for (ScoredTag scoredTag : topTags) {
            CandidateTag candidate = candidateByName.get(scoredTag.tagName());
            if (candidate == null) {
                continue;
            }
            ArticleTagMappingPo mapping = new ArticleTagMappingPo();
            mapping.setArticleId(articleId);
            mapping.setTagId(candidate.id());
            mapping.setTagDomain(candidate.domainName());
            mapping.setCreatedAt(now);
            articleTagMappingMapper.insert(mapping);
        }

        String tagsStr = topTags.stream()
                .map(ScoredTag::tagName)
                .collect(Collectors.joining(","));
        jdbcTemplate.update("UPDATE articles SET tags = ? WHERE id = ?", tagsStr, articleId);
    }

    /** 转换为现有分类器需要的领域对象，避免本期扩大改造 LLM 分类器接口。 */
    private static TagDomain toDomainEntity(TagDomainPo row) {
        TagDomain domain = new TagDomain();
        domain.setId(row.getId());
        domain.setName(row.getName());
        domain.setTableName(row.getTableName());
        domain.setDescription(row.getDescription());
        domain.setSortOrder(row.getSortOrder());
        domain.setCreatedAt(row.getCreatedAt());
        return domain;
    }

    /**
     * 候选标签结构化定位信息。
     * <p>LLM 打分结果只返回标签名称，落库时需要用该记录定位标签 ID 和所属领域。</p>
     */
    private record CandidateTag(long id, String name, String domainName) {
    }
}
