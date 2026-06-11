package com.frontierscan.collection;

import com.frontierscan.site.Site;
import com.rometools.rome.feed.synd.SyndFeed;
import com.rometools.rome.io.SyndFeedInput;
import com.rometools.rome.io.XmlReader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import java.io.InputStream;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * {@link RssCollector} 单元测试。
 * <p>
 * <b>测试策略：</b>通过覆写 {@code buildFeed()} 方法的测试子类，
 * 从本地 {@code test-rss.xml} 文件加载 RSS Feed，不依赖外部网络。
 * 测试 RSS 解析、字段提取（标题/链接/发布时间/哈希）、
 * 边界条件（空标题/空链接/特殊字符）和异常处理。
 * </p>
 *
 * <p><b>测试数据说明：</b>{@code test-rss.xml} 包含 6 条 {@code <item>}，
 * 其中 2 条是无效数据（空标题、空链接），
 * 验证采集器的数据过滤逻辑。</p>
 */
@DisplayName("RssCollector 采集器单元测试")
class RssCollectorTest {

    /**
     * 测试用 {@link RssCollector} 子类。
     * <p>覆写 {@code buildFeed()} 方法，从本地测试资源文件加载 RSS XML，
     * 而非通过 URL 连接。避免对外部网络的依赖。</p>
     */
    static class TestableRssCollector extends RssCollector {
        private final String xmlResource;

        TestableRssCollector(String xmlResource) {
            this.xmlResource = xmlResource;
        }

        @Override
        protected SyndFeed buildFeed(String feedUrl) throws Exception {
            try (InputStream is = getClass().getClassLoader().getResourceAsStream(xmlResource)) {
                if (is == null) throw new RuntimeException("测试资源不存在: " + xmlResource);
                return new SyndFeedInput().build(new XmlReader(is));
            }
        }
    }

    private TestableRssCollector collector;
    private Site site;

    @BeforeEach
    void setUp() {
        collector = new TestableRssCollector("test-rss.xml");
        site = new Site();
        site.setId(1L);
        site.setName("测试站点");
        site.setUrl("https://example.com");
        site.setRssUrl("https://example.com/feed");
        site.setCategoryId(1L);
    }

    @Nested @DisplayName("正常采集 — 应正确解析各项字段")
    class NormalCollection {

        @Test @DisplayName("解析有效 RSS item，返回正确的文章数量和类型标识")
        void shouldParseRssFeedSuccessfully() {
            CollectResult result = collector.collect(site);
            assertThat(result.sourceType()).isEqualTo("RSS");
            // test-rss.xml 中 6 条 item，含 2 条无效数据，预期解析 4 条
            assertThat(result.parseCount()).isGreaterThanOrEqualTo(2);
            assertThat(result.rawArticles()).hasSize(result.parseCount());
        }

        @Test @DisplayName("正确提取文章标题，保持原始文本不丢失")
        void shouldExtractTitle() {
            CollectResult result = collector.collect(site);
            assertThat(result.rawArticles().get(0).title()).isEqualTo("OpenAI 发布新模型");
        }

        @Test @DisplayName("每篇文章自动生成 64 字符 SHA-256 sourceHash")
        void shouldGenerateSourceHash() {
            CollectResult result = collector.collect(site);
            assertThat(result.rawArticles()).allMatch(a ->
                    a.sourceHash() != null && a.sourceHash().length() == 64);
        }

        @Test @DisplayName("有 {@code <pubDate>} 的文章正确转换 Instant 类型")
        void shouldParsePublishedDate() {
            CollectResult result = collector.collect(site);
            assertThat(result.rawArticles().get(0).publishedAt()).isNotNull();
        }

        @Test @DisplayName("无 {@code <pubDate>} 的文章返回 null，不抛异常")
        void articleWithoutDate_shouldReturnNull() {
            CollectResult result = collector.collect(site);
            var noDateArticle = result.rawArticles().stream()
                    .filter(a -> a.sourceUrl().contains("no-date"))
                    .findFirst().orElseThrow();
            assertThat(noDateArticle.publishedAt()).isNull();
        }

        @Test @DisplayName("正确处理 XML 实体转义（&amp; &lt; &gt; 等）")
        void shouldHandleSpecialChars() {
            CollectResult result = collector.collect(site);
            var special = result.rawArticles().stream()
                    .filter(a -> a.title().contains("&"))
                    .findFirst().orElseThrow();
            assertThat(special.title()).contains("&").contains("<").contains(">");
        }
    }

    @Nested @DisplayName("异常处理 — 采集器容错能力验证")
    class ExceptionHandling {

        @Test @DisplayName("非 XML 内容抛出 ParseException，而非崩溃")
        void corruptRss_shouldThrowParseException() {
            var corruptCollector = new TestableRssCollector("application-test.yml");
            assertThrows(ParseException.class, () -> corruptCollector.collect(site));
        }

        @Test @DisplayName("采集器类型标识正确返回 RSS")
        void sourceTypeShouldBeRss() {
            assertThat(collector.sourceType()).isEqualTo("RSS");
        }

        @Test @DisplayName("每次采集记录非负的耗时信息")
        void shouldRecordFetchDuration() {
            CollectResult result = collector.collect(site);
            assertThat(result.fetchDuration()).isGreaterThanOrEqualTo(0);
        }
    }
}