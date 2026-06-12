package com.frontierscan.llm.tag;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 标签评估 Agent — 两阶段闭环。
 * <p>
 * <b>Phase 1 — 领域分类：</b>从 {@code tag_domains} 表中获取所有可用领域，
 * 调用 {@link DomainClassifier} 对文章内容与各领域的相关性评分，
 * 取最多前 3 个最相关领域。<br>
 * <b>Phase 2 — 标签评分：</b>遍历 top 领域，通过 {@link JdbcTemplate} 动态查询对应的标签表
 * （表名从 {@code tag_domains.table_name} 获取），合并所有候选标签后调用
 * {@link LlmTagScorer} 评分，取 top 3 作为文章最终标签。<br>
 * <b>保存：</b>替换文章旧标签关联，并同步更新 {@code article.tags} 字段。
 * </p>
 *
 * <p><b>扩展性：</b>新增领域只需要：
 * <ol>
 *   <li>创建新的标签表（如 {@code finance_tags}）</li>
 *   <li>在 {@code tag_domains} 中插入一行记录</li>
 *   <li>无需修改任何 Java 代码</li>
 * </ol>
 * </p>
 */
@Slf4j
@Component
public class TagEvaluationAgent {

    private static final int MAX_DOMAINS = 3;
    private static final int MAX_TAGS = 3;

    private final TagDomainRepository tagDomainRepository;
    private final ArticleTagMappingRepository articleTagMappingRepository;
    private final DomainClassifier domainClassifier;
    private final LlmTagScorer llmTagScorer;
    private final JdbcTemplate jdbcTemplate;

    public TagEvaluationAgent(TagDomainRepository tagDomainRepository,
                              ArticleTagMappingRepository articleTagMappingRepository,
                              DomainClassifier domainClassifier,
                              LlmTagScorer llmTagScorer,
                              JdbcTemplate jdbcTemplate) {
        this.tagDomainRepository = tagDomainRepository;
        this.articleTagMappingRepository = articleTagMappingRepository;
        this.domainClassifier = domainClassifier;
        this.llmTagScorer = llmTagScorer;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 对一篇文章执行完整的标签评估流程。
     *
     * @param articleId 文章 ID
     * @param title     文章标题
     * @param content   文章正文（用于 LLM 评估）
     * @return 选中的标签列表（ScoredTag 包含 tagId, tagName, score），失败时返回空列表
     */
    @Transactional
    public List<ScoredTag> evaluate(Long articleId, String title, String content) {
        // Phase 1: 获取所有领域 → LLM 分类
        List<TagDomain> allDomains = tagDomainRepository.findAll();
        if (allDomains.isEmpty()) {
            log.warn("No tag domains configured; skipping tag evaluation for article {}", articleId);
            return List.of();
        }

        List<ScoredDomain> scoredDomains = domainClassifier.classify(allDomains, title, content);
        if (scoredDomains.isEmpty()) {
            log.debug("Domain classifier returned no results for article {}", articleId);
            return List.of();
        }

        // 取 top N 领域
        List<ScoredDomain> topDomains = scoredDomains.stream()
                .sorted(Comparator.comparingInt(ScoredDomain::score).reversed())
                .limit(MAX_DOMAINS)
                .toList();
        log.debug("Article {} classified into domains: {}", articleId,
                topDomains.stream().map(ScoredDomain::toString).collect(Collectors.joining(", ")));

        // Phase 2: 对每个 top 领域查询对应标签表，合并候选标签
        List<TagInfo> allCandidateTags = new ArrayList<>();
        for (ScoredDomain scoredDomain : topDomains) {
            String domainName = scoredDomain.domain();
            TagDomain domain = allDomains.stream()
                    .filter(d -> d.getName().equals(domainName))
                    .findFirst()
                    .orElse(null);
            if (domain == null) {
                log.warn("Domain '{}' not found in tag_domains table", domainName);
                continue;
            }
            List<TagInfo> tags = queryTagsFromTable(domain.getTableName());
            allCandidateTags.addAll(tags);
        }

        if (allCandidateTags.isEmpty()) {
            log.warn("No candidate tags found for article {}", articleId);
            return List.of();
        }

        // LLM 评分
        List<ScoredTag> scoredTags = llmTagScorer.scoreTags(allCandidateTags, title, content);
        if (scoredTags.isEmpty()) {
            return List.of();
        }

        // 取 top 3
        List<ScoredTag> topTags = scoredTags.stream()
                .sorted(Comparator.comparingInt(ScoredTag::score).reversed())
                .limit(MAX_TAGS)
                .toList();

        // 保存文章-标签关联
        saveArticleTags(articleId, topTags, topDomains);

        log.info("Tag evaluation complete for article {}: selected tags: {}",
                articleId, topTags.stream().map(ScoredTag::tagName).collect(Collectors.joining(", ")));
        return topTags;
    }

    /**
     * 通过 JdbcTemplate 动态查询领域标签表。
     * <p>
     * 表名从 {@code tag_domains.table_name} 获取，完全动态，
     * 新增领域时无需修改 Java 代码。
     * </p>
     *
     * @param tableName 标签表名（如 tech_tags）
     * @return 标签列表
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
     * 保存文章标签关联并同步更新 {@code article.tags} 字符串字段。
     * <p>
     * 先删除该文章所有旧关联，再批量插入新关联。在同一个事务内执行。
     * </p>
     *
     * @param articleId 文章 ID
     * @param topTags   选中的 top 标签
     * @param domains   标签所属的领域（用于确定 tagDomain 字段）
     */
    private void saveArticleTags(Long articleId, List<ScoredTag> topTags, List<ScoredDomain> domains) {
        // 删除旧关联
        articleTagMappingRepository.deleteByArticleId(articleId);

        // 我们需要知道每个标签属于哪个领域。由于 Phase 2 从多个领域合并了标签，
        // 但 topTags 现在只包含标签名称，没有领域信息。我们需要回查。
        // 简化方案：遍历所有 top 领域，在每个领域表中查找标签
        OffsetDateTime now = OffsetDateTime.now();
        List<ArticleTagMapping> mappings = new ArrayList<>();

        for (ScoredTag scoredTag : topTags) {
            for (ScoredDomain domain : domains) {
                TagDomain domainEntity = tagDomainRepository.findAll().stream()
                        .filter(d -> d.getName().equals(domain.domain()))
                        .findFirst().orElse(null);
                if (domainEntity == null) continue;

                String findSql = "SELECT id FROM " + domainEntity.getTableName()
                        + " WHERE name = ?";
                try {
                    Long tagId = jdbcTemplate.queryForObject(findSql, Long.class, scoredTag.tagName());
                    if (tagId != null) {
                        ArticleTagMapping mapping = new ArticleTagMapping();
                        mapping.setArticleId(articleId);
                        mapping.setTagId(tagId);
                        mapping.setTagDomain(domain.domain());
                        mapping.setCreatedAt(now);
                        mappings.add(mapping);
                        break; // 已找到，不再查找其他领域
                    }
                } catch (Exception e) {
                    // 该标签不在这个领域表中，继续查找下一个领域
                }
            }
        }

        if (!mappings.isEmpty()) {
            articleTagMappingRepository.saveAll(mappings);
        }

        // 同步更新 article.tags 字符串字段
        String tagsStr = topTags.stream()
                .map(ScoredTag::tagName)
                .collect(Collectors.joining(","));
        String updateSql = "UPDATE articles SET tags = ? WHERE id = ?";
        jdbcTemplate.update(updateSql, tagsStr, articleId);
    }
}
