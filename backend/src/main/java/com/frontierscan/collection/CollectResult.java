package com.frontierscan.collection;

import lombok.Builder;
import java.time.Instant;
import java.util.List;
import java.util.Objects;

/**
 * 采集器执行结果。
 *
 * @param sourceType    采集器类型（RSS / HTML）
 * @param rawArticles   原始文章列表（尚未去重和摘要）
 * @param collectedAt   采集时间
 * @param fetchDuration 抓取耗时（毫秒）
 * @param parseCount    解析出的文章数
 * @param errorMessage  采集错误信息（成功时为 null）
 */
@Builder
public record CollectResult(
        String sourceType,
        List<RawArticle> rawArticles,
        Instant collectedAt,
        long fetchDuration,
        int parseCount,
        String errorMessage
) {

    /**
     * 原始文章数据（采集器输出 → 去重/摘要/落库的中间格式）。
     *
     * @param title          文章标题
     * @param sourceUrl      原文链接
     * @param content        文章正文（全文 HTML）
     * @param contentExcerpt 正文纯文本截断（最长 5000 字）
     * @param publishedAt    发布时间
     * @param sourceHash     内容去重哈希
     */
    @Builder
    public record RawArticle(
            String title,
            String sourceUrl,
            String content,
            String contentExcerpt,
            Instant publishedAt,
            String sourceHash
    ) {
        public RawArticle {
            Objects.requireNonNull(title, "文章标题不能为空");
            Objects.requireNonNull(sourceUrl, "原文链接不能为空");
            if (sourceHash == null || sourceHash.isBlank()) {
                sourceHash = ArticleParser.generateSourceHash(sourceUrl);
            }
        }
    }
}