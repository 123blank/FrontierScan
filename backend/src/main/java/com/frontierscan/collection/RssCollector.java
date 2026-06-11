package com.frontierscan.collection;

import com.frontierscan.site.Site;
import com.rometools.rome.feed.synd.SyndEntry;
import com.rometools.rome.feed.synd.SyndFeed;
import com.rometools.rome.io.SyndFeedInput;
import com.rometools.rome.io.XmlReader;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import java.net.URL;
import java.net.URLConnection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * RSS/Atom 订阅采集器。
 * <p>使用 Rome 库解析 RSS 0.91/0.92/1.0/2.0 和 Atom 格式的 Feed。</p>
 */
@Slf4j
@Component
public class RssCollector implements Collector {

    static final int TIMEOUT_MILLIS = 15_000;
    static final int MAX_ENTRIES = 50;

    @Override
    public String sourceType() { return "RSS"; }

    @Override
    public CollectResult collect(Site site) {
        Instant start = Instant.now();
        String feedUrl = site.getRssUrl();
        List<CollectResult.RawArticle> articles = new ArrayList<>();
        String error = null;

        try {
            log.info("Starting RSS collection for: {} (feed: {})", site.getName(), feedUrl);
            SyndFeed feed = buildFeed(feedUrl);

            @SuppressWarnings("unchecked")
            List<SyndEntry> entries = feed.getEntries();
            int count = 0;
            for (SyndEntry entry : entries) {
                if (count >= MAX_ENTRIES) break;
                String title = entry.getTitle();
                String link = entry.getLink();
                if (title == null || link == null || link.isBlank()) continue;

                Date pubDate = entry.getPublishedDate();
                Instant publishedAt = pubDate != null ? pubDate.toInstant() : null;

                String contentHtml = null;
                if (entry.getDescription() != null && entry.getDescription().getValue() != null) {
                    contentHtml = entry.getDescription().getValue();
                }
                if ((contentHtml == null || contentHtml.length() < 50)
                        && entry.getContents() != null && !entry.getContents().isEmpty()) {
                    contentHtml = entry.getContents().get(0).getValue();
                }

                Instant extractedPublishedAt = publishedAt;
                if (extractedPublishedAt == null && contentHtml != null) {
                    extractedPublishedAt = ArticleParser.extractPublishedDate(
                            org.jsoup.Jsoup.parse(contentHtml));
                }

                String contentExcerpt = ArticleParser.cleanHtmlPreserveParagraphs(contentHtml, 5000);
                articles.add(CollectResult.RawArticle.builder()
                        .title(title).sourceUrl(link).content(contentHtml)
                        .contentExcerpt(contentExcerpt).publishedAt(extractedPublishedAt)
                        .sourceHash(ArticleParser.generateSourceHash(link)).build());
                count++;
            }
            log.info("RSS collection done: {} → {} articles", site.getName(), articles.size());

        } catch (java.net.SocketTimeoutException e) {
            error = "连接超时: " + e.getMessage();
            throw new ConnectionTimeoutException("RSS", feedUrl, error, e);
        } catch (Exception e) {
            error = "RSS 解析失败: " + e.getMessage();
            throw new ParseException("RSS", feedUrl, error, e);
        }

        return CollectResult.builder().sourceType("RSS").rawArticles(articles)
                .collectedAt(Instant.now()).fetchDuration(Instant.now().toEpochMilli()-start.toEpochMilli())
                .parseCount(articles.size()).errorMessage(error).build();
    }

    /**
     * 构建并解析 RSS Feed。
     * <p>protected 方法，允许测试子类覆写以返回模拟 Feed。</p>
     */
    protected SyndFeed buildFeed(String feedUrl) throws Exception {
        URL url = new URL(feedUrl);
        URLConnection conn = url.openConnection();
        conn.setConnectTimeout(TIMEOUT_MILLIS);
        conn.setReadTimeout(TIMEOUT_MILLIS);
        return new SyndFeedInput().build(new XmlReader(conn));
    }
}
