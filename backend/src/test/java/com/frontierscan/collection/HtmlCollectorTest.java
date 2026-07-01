package com.frontierscan.collection;

import org.jsoup.Jsoup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link HtmlCollector} 单元测试。
 */
@DisplayName("HtmlCollector 采集器")
class HtmlCollectorTest {

    @Test
    @DisplayName("优先使用 canonical URL 作为文章身份 URL")
    void shouldPreferCanonicalUrl() {
        var doc = Jsoup.parse("""
                <html><head>
                  <link rel="canonical" href="/news/123">
                </head><body><article><p>正文</p></article></body></html>
                """, "https://example.com/detail/123?utm_source=home");

        String result = HtmlCollector.resolveCanonicalUrl(
                doc,
                "https://example.com/detail/123?utm_source=home");

        assertThat(result).isEqualTo("https://example.com/news/123");
    }

    @Test
    @DisplayName("没有 canonical 时回退到 og:url")
    void shouldFallbackToOgUrl() {
        var doc = Jsoup.parse("""
                <html><head>
                  <meta property="og:url" content="https://example.com/news/456">
                </head><body><article><p>正文</p></article></body></html>
                """);

        String result = HtmlCollector.resolveCanonicalUrl(doc, "https://example.com/detail/456");

        assertThat(result).isEqualTo("https://example.com/news/456");
    }

    @Test
    @DisplayName("没有规范链接时保留原始详情页 URL")
    void shouldUseFallbackUrl() {
        var doc = Jsoup.parse("<html><body><article><p>正文</p></article></body></html>");

        String result = HtmlCollector.resolveCanonicalUrl(doc, "https://example.com/detail/789");

        assertThat(result).isEqualTo("https://example.com/detail/789");
    }
}
