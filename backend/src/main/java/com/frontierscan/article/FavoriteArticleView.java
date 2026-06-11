package com.frontierscan.article;

import java.time.OffsetDateTime;

/**
 * 收藏文章视图对象。
 * <p>
 * 用于 {@code GET /api/articles/favorites} 返回收藏页所需的文章卡片信息。
 * 相比只返回收藏关系 ID，该视图直接携带文章标题、摘要、标签和原文链接，
 * 前端无需再对每条收藏逐个请求文章详情。
 * </p>
 *
 * @param favoriteId 收藏记录 ID
 * @param articleId 文章 ID
 * @param title 文章标题
 * @param summary LLM 生成的简要总结
 * @param keyPoints LLM 生成的关键要点
 * @param tags 文章标签，逗号分隔
 * @param sourceUrl 原文链接
 * @param publishedAt 原文发布时间
 * @param collectedAt 系统采集时间
 * @param favoritedAt 收藏时间
 */
public record FavoriteArticleView(
        Long favoriteId,
        Long articleId,
        String title,
        String summary,
        String keyPoints,
        String tags,
        String sourceUrl,
        OffsetDateTime publishedAt,
        OffsetDateTime collectedAt,
        OffsetDateTime favoritedAt
) {}
