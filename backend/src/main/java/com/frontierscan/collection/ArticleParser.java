package com.frontierscan.collection;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.select.Elements;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * 文章内容提取工具类。
 * <p>
 * 从 HTML 中提取文章正文、发布时间等结构化信息。
 * 使用启发式算法识别主要内容区块，去除导航/广告等噪声。
 * </p>
 */
public final class ArticleParser {

    private static final int MAX_CONTENT_LENGTH = 5000;
    private static final Pattern WHITESPACE_PATTERN = Pattern.compile("\\s+");

    /**
     * 从 HTML 文档中提取文章正文纯文本。
     * <p>策略：优先 {@code <article>} 标签 → 次选 {@code .content / .post / .article} 类 →
     * 回退到 {@code <body>} 并去除 nav/header/footer/aside 等噪声元素。</p>
     *
     * @param doc Jsoup 解析后的 HTML 文档
     * @return 提取的正文纯文本（最前空白折叠）
     */
    public static String extractContent(Document doc) {
        Elements content = doc.select("article");
        if (content.isEmpty()) {
            content = doc.select(".content, .post-content, .article-content, " +
                    "[class*=content], [class*=post], [class*=entry], #content, #post");
        }
        if (content.isEmpty()) {
            content = doc.select("body");
        }
        // 移除已知噪声元素
        content.select("nav, header, footer, aside, .sidebar, .menu, .comments, " +
                ".comment, .nav, .footer, .header, script, style, iframe, noscript").remove();
        String text = content.text();
        text = WHITESPACE_PATTERN.matcher(text).replaceAll(" ").trim();
        return text.length() > MAX_CONTENT_LENGTH ? text.substring(0, MAX_CONTENT_LENGTH) : text;
    }

    /**
     * 从 HTML 中提取文章发布时间。
     * <p>策略：{@code <time>} 标签 → {@code meta[property=article:published_time]}
     * → {@code meta[name=pubdate]} → 含 time/date 关键词的 class/id。</p>
     *
     * @param doc Jsoup 文档
     * @return 解析到的时间，解析失败返回 null
     */
    public static Instant extractPublishedDate(Document doc) {
        // 1. <time> 标签的 datetime 属性
        Elements timeTag = doc.select("time[datetime]");
        if (!timeTag.isEmpty()) {
            Instant result = tryParse(timeTag.attr("datetime"));
            if (result != null) return result;
        }
        // 2. <meta property="article:published_time">
        Elements meta = doc.select("meta[property=article:published_time]");
        if (meta.isEmpty()) meta = doc.select("meta[name=pubdate]");
        if (meta.isEmpty()) meta = doc.select("meta[name=publication_date]");
        if (!meta.isEmpty()) {
            Instant result = tryParse(meta.attr("content"));
            if (result != null) return result;
        }
        // 3. 含 time/date 关键词的 class/id
        Elements dateEl = doc.select("[class*=time], [class*=date], [id*=time], [id*=date]");
        for (var el : dateEl) {
            Instant result = tryParse(el.text());
            if (result != null) return result;
        }
        return null;
    }

    /**
     * 清理 HTML 标签，保留纯文本并限制最大长度。
     *
     * @param html      原始 HTML
     * @param maxLength 最大字符数（超过则截断）
     * @return 纯文本
     */
    public static String cleanHtml(String html, int maxLength) {
        if (html == null || html.isBlank()) return "";
        String text = Jsoup.parse(html).text();
        text = WHITESPACE_PATTERN.matcher(text).replaceAll(" ").trim();
        return text.length() > maxLength ? text.substring(0, maxLength) : text;
    }

    /**
     * 从原文 URL 生成 SHA-256 去重哈希。
     *
     * @param sourceUrl 原文链接
     * @return 64 字符十六进制哈希
     */
    public static String generateSourceHash(String sourceUrl) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(sourceUrl.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    /** 尝试多种 ISO 时间格式解析。 */
    private static Instant tryParse(String text) {
        if (text == null || text.isBlank()) return null;
        String[] formats = {
                "yyyy-MM-dd'T'HH:mm:ssXXX", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                "yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm:ss",
                "yyyy-MM-dd"
        };
        for (String fmt : formats) {
            try {
                return LocalDateTime.parse(text, DateTimeFormatter.ofPattern(fmt))
                        .atZone(ZoneId.of("UTC")).toInstant();
            } catch (DateTimeParseException ignored) {}
        }
        // Try with zone ID (e.g., "2026-06-11T10:00:00+08:00")
        try {
            return ZonedDateTime.parse(text).toInstant();
        } catch (Exception ignored) {}
        return null;
    }

    private ArticleParser() {}
}