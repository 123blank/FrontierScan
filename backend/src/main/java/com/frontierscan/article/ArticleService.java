package com.frontierscan.article;

import com.frontierscan.collection.CollectResult;
import com.frontierscan.common.error.ResourceNotFoundException;
import com.frontierscan.llm.LlmProperties;
import com.frontierscan.llm.tag.TagEvaluationAgent;
import com.frontierscan.llm.tag.mapper.ArticleTagMappingMapper;
import org.springframework.data.domain.Page;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 文章管理业务服务。
 * <p>
 * 提供文章的多维度分页查询、批量落库、收藏管理和统计功能。
 * 所有操作强制绑定 userId，确保用户只能访问自己的数据。
 * 批量保存方法已标记 {@code @Transactional} 保证原子性。
 * </p>
 */
@Service
public class ArticleService {

    private final ArticleRepository articleRepository;
    private final FavoriteRepository favoriteRepository;
    private final TagEvaluationAgent tagEvaluationAgent;
    private final ArticleTagMappingMapper articleTagMappingMapper;
    private final LlmProperties llmProperties;
    private static final Logger log = LoggerFactory.getLogger(ArticleService.class);

    public ArticleService(ArticleRepository articleRepository,
                          FavoriteRepository favoriteRepository,
                          TagEvaluationAgent tagEvaluationAgent,
                          ArticleTagMappingMapper articleTagMappingMapper,
                          LlmProperties llmProperties) {
        this.articleRepository = articleRepository;
        this.favoriteRepository = favoriteRepository;
        this.tagEvaluationAgent = tagEvaluationAgent;
        this.articleTagMappingMapper = articleTagMappingMapper;
        this.llmProperties = llmProperties;
    }

    /** 分页查询文章列表，支持按分类和来源网站筛选。 */
    public Page<Article> listByUser(Long userId, Long categoryId, Long siteId,
                                    String keyword, Long tagId,
                                    String startDateStr, String endDateStr,
                                    Pageable pageable) {
        // No search filters: use proven JPA derived query methods
        if (keyword == null && tagId == null && startDateStr == null && endDateStr == null) {
            if (categoryId != null) {
                return articleRepository.findByUserIdAndCategoryIdOrderByCollectedAtDesc(userId, categoryId, pageable);
            }
            if (siteId != null) {
                return articleRepository.findByUserIdAndSiteIdOrderByCollectedAtDesc(userId, siteId, pageable);
            }
            return articleRepository.findByUserIdOrderByCollectedAtDesc(userId, pageable);
        }
       // Filters present: use native query with explicit type casting
       String keywordPattern = keyword != null ? "%" + keyword.toLowerCase() + "%" : null;
       return articleRepository.findWithFilters(
               userId, categoryId, siteId, keywordPattern, tagId, startDateStr, endDateStr, pageable);
    }

    /** 获取文章详情，同时校验用户权限。 */
    public Article getById(Long userId, Long id) {
        Article article = articleRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("文章不存在"));
        if (!article.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("文章不存在");
        }
        return article;
    }

    /**
     * 批量去重并保存采集到的文章。
     * <p>
     * 根据 sourceHash 过滤数据库中已有的内容，只保存新文章。
     * sourceHash 基于规范化 URL 全局生成，因此同一篇文章跨用户、跨 RSS/HTML 链路也只入库一次。
     * 使用 {@code @Transactional} 保证批量操作的原子性。
     * </p>
     *
     * @param userId        当前用户 ID
     * @param siteId        来源网站 ID
     * @param categoryId    所属分类 ID
     * @param rawArticles   原始文章列表（采集器输出）
     * @return 实际新增保存的文章列表
     */
    @Transactional
    public List<Article> batchSaveArticles(Long userId, Long siteId, Long categoryId,
                                           List<CollectResult.RawArticle> rawArticles) {
        List<Article> newArticles = rawArticles.stream()
                .filter(raw -> !articleRepository.existsBySourceHash(raw.sourceHash()))
                .map(raw -> {
                    Article article = new Article();
                    article.setUserId(userId);
                    article.setSiteId(siteId);
                    article.setCategoryId(categoryId);
                    article.setTitle(raw.title());
                    article.setSourceUrl(raw.sourceUrl());
                    article.setContentExcerpt(raw.contentExcerpt());
                    // contentFull 保存采集到的清洗后全文正文，摘要 Map-Reduce 优先读取该字段；
                    // contentExcerpt 仅保留为列表展示和历史数据兜底，二者职责不能混用。
                    article.setContentFull(raw.content());
                    // 新文章入库后统一进入 PENDING，等待采集编排器调用 LLM 生成摘要并写入质量状态。
                    article.setSummaryStatus(ArticleSummaryStatus.PENDING);
                    article.setSummaryRetryCount(0);
                    article.setSourceHash(raw.sourceHash());
                    article.setPublishedAt(raw.publishedAt() != null
                            ? raw.publishedAt().atOffset(OffsetDateTime.now().getOffset())
                            : null);
                    article.setCollectedAt(OffsetDateTime.now());
                    article.setCreatedAt(OffsetDateTime.now());
                    return article;
                })
                .toList();

        if (newArticles.isEmpty()) {
            return List.of();
        }
        return articleRepository.saveAll(newArticles);
    }

    /** 切换收藏状态。 */
    @Transactional
    public void toggleFavorite(Long userId, Long articleId) {
        getById(userId, articleId);
        if (favoriteRepository.existsByUserIdAndArticleId(userId, articleId)) {
            favoriteRepository.deleteByUserIdAndArticleId(userId, articleId);
        } else {
            Favorite fav = new Favorite();
            fav.setUserId(userId);
            fav.setArticleId(articleId);
            fav.setCreatedAt(OffsetDateTime.now());
            favoriteRepository.save(fav);
        }
    }

    /**
     * 取消收藏。
     * <p>
     * 取消收藏必须先校验文章归属，避免用户通过收藏接口探测或操作其他用户文章。
     * </p>
     */
    @Transactional
    public void removeFavorite(Long userId, Long articleId) {
        getById(userId, articleId);
        if (favoriteRepository.existsByUserIdAndArticleId(userId, articleId)) {
            favoriteRepository.deleteByUserIdAndArticleId(userId, articleId);
        }
    }

    /** 检查文章是否已被收藏。 */
    public boolean isFavorited(Long userId, Long articleId) {
        return favoriteRepository.existsByUserIdAndArticleId(userId, articleId);
    }

    /** 获取收藏列表。 */
    public List<Favorite> listFavorites(Long userId) {
        return favoriteRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    /**
     * 获取当前用户收藏的文章视图列表。
     * <p>
     * 收藏页直接使用该方法渲染文章卡片，避免前端逐条请求文章详情。
     * Repository 查询同时校验收藏关系和文章本体的 {@code userId}，保证用户数据隔离。
     * </p>
     *
     * @param userId 当前用户 ID
     * @return 收藏文章视图列表
     */
    public List<FavoriteArticleView> listFavoriteArticles(Long userId) {
        return favoriteRepository.findFavoriteArticleViewsByUserId(userId);
    }

    /** 统计文章总数。 */
    public List<FavoriteArticleView> listFavoriteArticlesWithFilters(Long userId, String keyword,
                                                                      Long tagId,
                                                                      OffsetDateTime startDate,
                                                                      OffsetDateTime endDate) {
        // ????????????????? JPQL ???
        List<FavoriteArticleView> favorites = favoriteRepository.findFavoriteArticleViewsByUserId(userId);

        // ?????????
        if (keyword != null && !keyword.isBlank()) {
            String lowerKw = keyword.toLowerCase();
            favorites = favorites.stream()
                    .filter(fav -> fav.title().toLowerCase().contains(lowerKw)
                            || (fav.summary() != null && fav.summary().toLowerCase().contains(lowerKw)))
                    .toList();
        }

        // 收藏页标签筛选统一走结构化 article_tags 关系表；后续标签模块数据访问以 MyBatis-Plus 为主。
        if (tagId != null) {
            List<Long> ids = articleTagMappingMapper.findArticleIdsByTagId(tagId);
            favorites = favorites.stream()
                    .filter(fav -> ids.contains(fav.articleId()))
                    .toList();
        }

        // ??????????
        if (startDate != null) {
            favorites = favorites.stream()
                    .filter(fav -> fav.publishedAt() != null
                            && (fav.publishedAt().isEqual(startDate) || fav.publishedAt().isAfter(startDate)))
                    .toList();
        }
        if (endDate != null) {
            favorites = favorites.stream()
                    .filter(fav -> fav.publishedAt() != null
                            && (fav.publishedAt().isEqual(endDate) || fav.publishedAt().isBefore(endDate)))
                    .toList();
        }

        return favorites;
    }

    /**
     * 对文章执行标签评估，并返回是否成功选中标签。
     * <p>
     * 标签输入统一由摘要、关键要点和受控正文兜底拼接而成。摘要和要点代表用户最终看到的结构化内容，
     * 正文全文作为语义兜底，但会按配置截断，避免标签评估成本随超长文章无限增长。
     * </p>
     *
     * @param articleId 文章 ID
     * @return {@code true} 表示标签评估成功选中至少一个标签；{@code false} 表示失败或未命中标签
     */
    public boolean evaluateArticleTags(Long articleId) {
        try {
            Article article = articleRepository.findById(articleId).orElse(null);
            if (article == null) {
                log.warn("Tag evaluation skipped because article {} does not exist", articleId);
                return false;
            }
            return !tagEvaluationAgent.evaluate(
                    article.getId(),
                    article.getTitle(),
                    buildTagEvaluationContent(article)).isEmpty();
        } catch (Exception e) {
            log.warn("Tag evaluation failed for article {}: {}", articleId, e.getMessage());
            return false;
        }
    }

    /**
     * 构建标签评估输入文本。
     * <p>按“摘要 + 关键要点 + 正文兜底”的顺序拼接，既贴近阅读闭环，又保留原始正文语义作为兜底。</p>
     */
    private String buildTagEvaluationContent(Article article) {
        StringBuilder content = new StringBuilder();
        appendSection(content, "摘要", article.getSummary());
        appendSection(content, "关键要点", article.getKeyPoints());
        appendSection(content, "正文兜底", truncate(resolveTagSourceContent(article),
                llmProperties.tag().maxContentCharsValue()));
        return content.toString();
    }

    /**
     * 解析标签评估的正文兜底来源。
     * <p>新增文章优先使用全文字段；历史文章没有全文时回退到片段，保证旧数据仍可重新摘要和重评标签。</p>
     */
    private static String resolveTagSourceContent(Article article) {
        if (article.getContentFull() != null && !article.getContentFull().isBlank()) {
            return article.getContentFull();
        }
        return article.getContentExcerpt();
    }

    private static String truncate(String value, int maxLength) {
        if (value == null || value.isBlank()) {
            return value;
        }
        String trimmed = value.trim();
        return trimmed.length() > maxLength ? trimmed.substring(0, maxLength) : trimmed;
    }

    private static void appendSection(StringBuilder content, String title, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        if (!content.isEmpty()) {
            content.append("\n\n");
        }
        content.append(title).append("：").append(value.trim());
    }

    /** ???????????? */
    public long countByUser(Long userId) {
        return articleRepository.countByUserId(userId);
    }

    /** 统计今日采集数。 */
    public long countToday(Long userId) {
        return articleRepository.countByUserIdAndCollectedAtAfter(userId,
                OffsetDateTime.now().withHour(0).withMinute(0).withSecond(0).withNano(0));
    }

    /** 检查 sourceHash 是否已存在。 */
    public boolean existsByHash(Long userId, String hash) {
        return articleRepository.existsByUserIdAndSourceHash(userId, hash);
    }

    /**
     * 更新文章的 LLM 摘要结果。
     * <p>
     * 采集完成后由 {@link com.frontierscan.collection.CollectionOrchestrator} 异步调用。
     * 摘要/要点/标签全部为 {@code null} 时表示 LLM 未处理或不支持。
     * </p>
     *
     * @param articleId 文章 ID
     * @param summary   LLM 返回的结构化摘要
     */
    @Transactional
    public void updateLlmSummary(Long articleId, com.frontierscan.llm.SummaryResult summary) {
        if (summary == null) {
            return;
        }
        articleRepository.findById(articleId).ifPresent(article -> {
            if (summary.optimizedTitle() != null) {
                article.setTitle(summary.optimizedTitle());
            }
            if (summary.summary() != null) {
                article.setSummary(summary.summary());
            }
            if (summary.keyPoints() != null && !summary.keyPoints().isEmpty()) {
                article.setKeyPoints(String.join("\n", summary.keyPoints()));
            }
            if (summary.tags() != null && !summary.tags().isEmpty()) {
                article.setTags(String.join(",", summary.tags()));
            }
            articleRepository.save(article);
        });
    }
}
