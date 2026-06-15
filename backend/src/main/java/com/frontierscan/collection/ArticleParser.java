package com.frontierscan.collection;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 文章内容提取工具类。
 * <p>
 * 从 HTML 中提取文章正文、发布时间等结构化信息。
 * 使用启发式算法识别主要内容区块，去除导航/广告等噪声。
 * </p>
 */
public final class ArticleParser {

    private static final Pattern WHITESPACE_PATTERN = Pattern.compile("\\s+");
    private static final Pattern CHINESE_DATE_PATTERN =
            Pattern.compile("(20\\d{2})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日?");
    private static final Pattern SLASH_DATE_PATTERN =
            Pattern.compile("(20\\d{2})[/-](\\d{1,2})[/-](\\d{1,2})");

    /**
     * 从 HTML 文档中提取文章正文纯文本。
     * <p>策略：优先 {@code <article>} 标签 → 次选 {@code .content / .post / .article} 类 →
     * 回退到 {@code <body>} 并去除 nav/header/footer/aside 等噪声元素。</p>
     *
     * @param doc Jsoup 解析后的 HTML 文档
     * @return 提取的全文正文纯文本，段落之间以空行分隔
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
        return extractReadableText(content);
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
        // 1. <time> 标签的 datetime 属性或文本内容
        Elements timeTag = doc.select("time[datetime]");
        if (!timeTag.isEmpty()) {
            Instant result = tryParse(timeTag.attr("datetime"));
            if (result != null) return result;
        }
        Elements timeText = doc.select("time");
        for (var el : timeText) {
            Instant result = tryParse(el.text());
            if (result != null) return result;
        }

        // 2. 常见 meta / JSON-LD microdata 发布时间字段
        String[] metaSelectors = {
                "meta[property=article:published_time]",
                "meta[property=article:modified_time]",
                "meta[property=og:published_time]",
                "meta[name=pubdate]",
                "meta[name=publishdate]",
                "meta[name=publication_date]",
                "meta[name=date]",
                "meta[itemprop=datePublished]",
                "meta[itemprop=dateModified]"
        };
        for (String selector : metaSelectors) {
            Elements meta = doc.select(selector);
            if (!meta.isEmpty()) {
                Instant result = tryParse(meta.attr("content"));
                if (result != null) return result;
            }
        }

        // 3. 含 time/date 关键词的 class/id
        Elements dateEl = doc.select("[class*=time], [class*=date], [id*=time], [id*=date]");
        for (var el : dateEl) {
            Instant result = tryParse(el.text());
            if (result != null) return result;
        }

        // 4. 正文中常见的中文日期，例如“日期：2026年6月5日”
        Instant result = tryParse(doc.body() != null ? doc.body().text() : doc.text());
        if (result != null) return result;

        return null;
    }

    /**
     * 清理 HTML 并保留段落边界。
     * <p>
     * 用于 RSS/Atom 内容清理。与 {@link #cleanHtml(String, int)} 不同，本方法会保留
     * {@code p/li/h1-h6/br} 等块级语义，便于前端按段落展示正文内容。
     * </p>
     *
     * @param html      原始 HTML
     * @param maxLength 最大字符数（超过则截断）
     * @return 带段落换行的纯文本
     */
    public static String cleanHtmlPreserveParagraphs(String html) {
        if (html == null || html.isBlank()) return "";
        Document doc = Jsoup.parse(html);
        return extractReadableText(doc.select("body"));
    }

    /**
     * 清理 HTML 并保留段落边界，同时按指定长度截断。
     * <p>
     * 采集链路会同时保存全文和列表片段：全文通过 {@link #cleanHtmlPreserveParagraphs(String)} 生成，
     * 片段通过本方法生成。两者共用同一套清洗逻辑，避免摘要输入和卡片展示出现语义不一致。
     * </p>
     *
     * @param html      原始 HTML
     * @param maxLength 最大字符数，超过则截断
     * @return 带段落换行的纯文本片段
     */
    public static String cleanHtmlPreserveParagraphs(String html, int maxLength) {
        String text = cleanHtmlPreserveParagraphs(html);
        return text.length() > maxLength ? text.substring(0, maxLength) : text;
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

    /**
     * 从候选内容区提取可读文本，并尽量保留段落结构。
     * <p>
     * 文章详情页需要格式化正文，不能把所有文本压缩成一整段。这里优先提取常见块级内容，
     * 对每个块内部仍折叠多余空白，块之间使用双换行分隔。
     * </p>
     */
    private static String extractReadableText(Elements content) {
        Elements blocks = content.select("h1, h2, h3, h4, h5, h6, p, li, blockquote");
        List<String> paragraphs = new ArrayList<>();
        for (Element block : blocks) {
            String text = WHITESPACE_PATTERN.matcher(block.text()).replaceAll(" ").trim();
            if (!text.isBlank()) {
                paragraphs.add(text);
            }
        }
        if (paragraphs.isEmpty()) {
            String text = content.text();
            return WHITESPACE_PATTERN.matcher(text).replaceAll(" ").trim();
        }
        return String.join("\n\n", paragraphs);
    }

    /** 尝试多种时间格式解析。 */
    private static Instant tryParse(String text) {
        if (text == null || text.isBlank()) return null;
        String normalized = WHITESPACE_PATTERN.matcher(text).replaceAll(" ").trim();

        try {
            return Instant.parse(normalized);
        } catch (Exception ignored) {}

        try {
            return OffsetDateTime.parse(normalized).toInstant();
        } catch (Exception ignored) {}

        try {
            return ZonedDateTime.parse(normalized).toInstant();
        } catch (Exception ignored) {}

        String[] formats = {
                "yyyy-MM-dd'T'HH:mm:ssXXX", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                "yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm:ss"
        };
        for (String fmt : formats) {
            try {
                return LocalDateTime.parse(normalized, DateTimeFormatter.ofPattern(fmt))
                        .atZone(ZoneId.of("UTC")).toInstant();
            } catch (DateTimeParseException ignored) {}
        }

        try {
            return LocalDate.parse(normalized, DateTimeFormatter.ISO_LOCAL_DATE)
                    .atStartOfDay(ZoneId.of("UTC")).toInstant();
        } catch (Exception ignored) {}

        var chineseMatcher = CHINESE_DATE_PATTERN.matcher(normalized);
        if (chineseMatcher.find()) {
            return LocalDate.of(
                    Integer.parseInt(chineseMatcher.group(1)),
                    Integer.parseInt(chineseMatcher.group(2)),
                    Integer.parseInt(chineseMatcher.group(3))
            ).atStartOfDay(ZoneId.of("UTC")).toInstant();
        }

        var slashMatcher = SLASH_DATE_PATTERN.matcher(normalized);
        if (slashMatcher.find()) {
            return LocalDate.of(
                    Integer.parseInt(slashMatcher.group(1)),
                    Integer.parseInt(slashMatcher.group(2)),
                    Integer.parseInt(slashMatcher.group(3))
            ).atStartOfDay(ZoneId.of("UTC")).toInstant();
        }

        return null;
    }

    private ArticleParser() {}
}
