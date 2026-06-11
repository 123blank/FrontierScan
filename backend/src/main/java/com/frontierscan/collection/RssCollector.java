package com.frontierscan.collection;

import com.frontierscan.site.Site;
import com.rometools.rome.feed.synd.SyndEntry;
import com.rometools.rome.io.SyndFeedInput;
import com.rometools.rome.io.XmlReader;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import java.net.URL;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * RSS/Atom 订阅采集器。
 * <p>
 * 使用 Rome 库解析 RSS 0.91/0.92/1.0/2.0 和 Atom 格式的 Feed，
 * 提取文章标题、链接、正文摘要和发布时间。
 * 连接超时 15 秒，单次最多采集 50 条。
 * </p>
 */
@Slf4j
@Component
public class RssCollector implements Collector {

    static final int TIMEOUT_MILLIS = 15_000;
    static final int MAX_ENTRIES = 50;

    @Override
    public String sourceType() {
        return "RSS";
    }

    @Override
    public CollectResult collect(Site site) {
        Instant start = Instant.now();
        String feedUrl = site.getRssUrl();
        List<CollectResult.RawArticle> articles = new ArrayList<>();
        String error = null;

        try {
            log.info("Starting RSS collection for site: {} (feed: {})", site.getName(), feedUrl);

            URL url = new URL(feedUrl);
            SyndFeedInput input = new SyndFeedInput();
            // 设置连接和读取超时
            java.net.URLConnection conn = url.openConnection();
            conn.setConnectTimeout(TIMEOUT_MILLIS);
            conn.setReadTimeout(TIMEOUT_MILLIS);
            var feed = input.build(new XmlReader(conn));

            @SuppressWarnings("unchecked")
            List<SyndEntry> entries = feed.getEntries();

            int count = 0;
            for (SyndEntry entry : entries) {
                if (count >= MAX_ENTRIES) break;

                String title = entry.getTitle();
                String link = entry.getLink();
                if (title == null || link == null || link.isBlank()) continue;

                Date pubDate = entry.getPublishedDate();
                Instant publishedAt = pubDate != null
                        ? pubDate.toInstant()
                        : null;

                // 提取正文：先 RSS description，不够时取 contents
                String contentHtml = null;
                if (entry.getDescription() != null && entry.getDescription().getValue() != null) {
                    contentHtml = entry.getDescription().getValue();
                }
                if ((contentHtml == null || contentHtml.length() < 50) && entry.getContents() != null && !entry.getContents().isEmpty()) {
                    contentHtml = entry.getContents().get(0).getValue();
                }

                String contentExcerpt = ArticleParser.cleanHtml(contentHtml, 5000);
                String sourceHash = ArticleParser.generateSourceHash(link);

                articles.add(CollectResult.RawArticle.builder()
                        .title(title)
                        .sourceUrl(link)
                        .content(contentHtml)
                        .contentExcerpt(contentExcerpt)
                        .publishedAt(publishedAt)
                        .sourceHash(sourceHash)
                        .build());

                count++;
            }

            log.info("RSS collection complete for {}: {} entries (limit {})", site.getName(), entries.size(), MAX_ENTRIES);

        } catch (java.net.SocketTimeoutException e) {
            error = "连接超时: " + e.getMessage();
            log.warn("RSS collection timeout for {}: {}", site.getName(), e.getMessage());
            throw new ConnectionTimeoutException("RSS", feedUrl, error, e);
        } catch (Exception e) {
            error = "RSS 解析失败: " + e.getMessage();
            log.warn("RSS collection failed for {}: {}", site.getName(), e.getMessage());
            throw new ParseException("RSS", feedUrl, error, e);
        }

        Instant end = Instant.now();
        return CollectResult.builder()
                .sourceType("RSS")
                .rawArticles(articles)
                .collectedAt(end)
                .fetchDuration(end.toEpochMilli() - start.toEpochMilli())
                .parseCount(articles.size())
                .errorMessage(error)
                .build();
    }
}