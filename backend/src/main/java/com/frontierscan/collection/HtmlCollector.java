package com.frontierscan.collection;

import com.frontierscan.site.Site;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * HTML 网页抓取采集器。
 * <p>
 * 使用 Jsoup 抓取目标网站首页，通过通用规则识别文章链接，
 * 逐个抓取详情页并提取正文内容。
 * 作为 RSS 不可用时的降级方案。
 * 单次最多采集 20 条，只抓取同域名内容。
 * </p>
 */
@Slf4j
@Component
public class HtmlCollector implements Collector {

    static final int TIMEOUT_MILLIS = 15_000;
    static final int MAX_ARTICLES = 20;
    static final int MAX_ARTICLE_CONTENT = 5000;

    /** 文章链接识别选择器（从首页查找文章入口）。 */
    private static final String ARTICLE_LINK_SELECTOR =
            "a[href*=/article/], a[href*=/news/], a[href*=/blog/], a[href*=/post/], " +
            "a[href*=/story/], a[href*=/202], a[href*=/p/], " +
            "article a[href], .post a[href], .entry a[href], .card a[href]";

    @Override
    public String sourceType() {
        return "HTML";
    }

    @Override
    public CollectResult collect(Site site) {
        Instant start = Instant.now();
        List<CollectResult.RawArticle> articles = new ArrayList<>();
        String error = null;

        try {
            log.info("Starting HTML collection for site: {} (url: {})", site.getName(), site.getUrl());
            Document homeDoc = fetchDocument(site.getUrl());
            String baseDomain = extractDomain(site.getUrl());

            // 提取文章链接并去重
            Set<String> articleUrls = new HashSet<>();
            var links = homeDoc.select(ARTICLE_LINK_SELECTOR);
            for (var link : links) {
                String href = link.absUrl("href");
                if (href.isEmpty()) continue;
                try {
                    String linkDomain = extractDomain(href);
                    if (!linkDomain.equals(baseDomain)) continue; // 只抓同域名
                    if (articleUrls.contains(href)) continue;
                    articleUrls.add(href);
                    if (articleUrls.size() >= MAX_ARTICLES) break;
                } catch (Exception ignored) {}
            }

            log.info("Found {} article links on {} home page", articleUrls.size(), site.getName());

            // 逐个抓取文章详情
            for (String articleUrl : articleUrls) {
                try {
                    Document articleDoc = fetchDocument(articleUrl);
                    String title = articleDoc.title();
                    if (title == null || title.isBlank()) continue;

                    // HTML 采集链路必须保留清洗后的全文正文，供后续摘要 Map-Reduce 覆盖完整文章。
                    // contentExcerpt 仅作为列表展示和历史兜底片段，不能反向限制全文字段。
                    String content = ArticleParser.extractContent(articleDoc);
                    if (content.length() < 20) continue; // 正文太短，跳过

                    String contentExcerpt = content.length() > MAX_ARTICLE_CONTENT
                            ? content.substring(0, MAX_ARTICLE_CONTENT) : content;
                    Instant publishedAt = ArticleParser.extractPublishedDate(articleDoc);
                    String sourceHash = ArticleParser.generateSourceHash(articleUrl);

                    // 清理标题中的站点名后缀
                    String cleanTitle = title.replaceAll("\\s*[-–|]\\s*.*$", "").trim();

                    articles.add(CollectResult.RawArticle.builder()
                            .title(cleanTitle)
                            .sourceUrl(articleUrl)
                            .content(content)
                            .contentExcerpt(contentExcerpt)
                            .publishedAt(publishedAt)
                            .sourceHash(sourceHash)
                            .build());

                } catch (Exception e) {
                    log.warn("Failed to fetch article: {} - {}", articleUrl, e.getMessage());
                }
            }

            log.info("HTML collection complete for {}: {} articles collected", site.getName(), articles.size());

        } catch (Exception e) {
            error = "HTML 采集失败: " + e.getMessage();
            log.warn("HTML collection failed for {}: {}", site.getName(), e.getMessage());
            throw new ConnectionTimeoutException("HTML", site.getUrl(), error, e);
        }

        Instant end = Instant.now();
        return CollectResult.builder()
                .sourceType("HTML")
                .rawArticles(articles)
                .collectedAt(end)
                .fetchDuration(end.toEpochMilli() - start.toEpochMilli())
                .parseCount(articles.size())
                .errorMessage(error)
                .build();
    }

    /** 带超时配置的 Jsoup 文档抓取。 */
    private Document fetchDocument(String url) throws Exception {
        return Jsoup.connect(url)
                .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
                .timeout(TIMEOUT_MILLIS)
                .followRedirects(true)
                .get();
    }

    /** 从 URL 中提取域名。 */
    private String extractDomain(String url) {
        try {
            URI uri = new URI(url);
            String host = uri.getHost();
            return host != null ? host.startsWith("www.") ? host.substring(4) : host : "";
        } catch (URISyntaxException e) {
            return "";
        }
    }
}
