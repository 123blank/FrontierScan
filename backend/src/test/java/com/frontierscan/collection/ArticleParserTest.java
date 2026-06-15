package com.frontierscan.collection;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ArticleParser} 工具类单元测试。
 * <p>
 * <b>测试策略：</b>纯工具类测试，无需 Spring 上下文。
 * 通过 Jsoup 构建模拟 HTML 文档覆盖正文提取、发布时间提取、SHA-256 哈希生成等场景。
 * </p>
 *
 * <p><b>类结构说明：</b>使用 {@code @Nested} 按被测试方法分组，
 * 每组包含正常路径、边界条件和异常场景三个维度的用例。</p>
 */
@DisplayName("ArticleParser 工具类")
class ArticleParserTest {

    // ==================== generateSourceHash ====================

    @Nested @DisplayName("generateSourceHash()")
    class GenerateSourceHash {

        @Test @DisplayName("相同 URL 生成相同哈希（幂等性校验）")
        void sameUrl_shouldReturnSameHash() {
            String hash1 = ArticleParser.generateSourceHash("https://example.com/article/1");
            String hash2 = ArticleParser.generateSourceHash("https://example.com/article/1");
            assertThat(hash1).isEqualTo(hash2);
        }

        @Test @DisplayName("不同 URL 生成不同哈希（冲突检测）")
        void differentUrl_shouldReturnDifferentHash() {
            String hash1 = ArticleParser.generateSourceHash("https://example.com/a");
            String hash2 = ArticleParser.generateSourceHash("https://example.com/b");
            assertThat(hash1).isNotEqualTo(hash2);
        }

        @Test @DisplayName("输出为 64 字符十六进制字符串（SHA-256 规范）")
        void shouldReturnSha256Hex() {
            String hash = ArticleParser.generateSourceHash("https://example.com/article");
            assertThat(hash).hasSize(64);
            assertThat(hash).matches("[0-9a-f]{64}");
        }

        @Test @DisplayName("空 URL 不会导致异常，仍生成有效哈希")
        void emptyUrl_shouldStillProduceHash() {
            String hash = ArticleParser.generateSourceHash("");
            assertThat(hash).hasSize(64);
        }
    }

    // ==================== cleanHtml ====================

    @Nested @DisplayName("cleanHtml() 正文清理")
    class CleanHtml {

        @Test @DisplayName("去除 HTML 标签，保留纯文本")
        void shouldStripTags() {
            String html = "<p>Hello <b>World</b></p>";
            assertThat(ArticleParser.cleanHtml(html, 100)).isEqualTo("Hello World");
        }

        @Test @DisplayName("null 输入返回空字符串，不抛出异常")
        void nullInput_shouldReturnEmpty() {
            assertThat(ArticleParser.cleanHtml(null, 100)).isEqualTo("");
        }

        @Test @DisplayName("空白字符串输入返回空字符串")
        void blankInput_shouldReturnEmpty() {
            assertThat(ArticleParser.cleanHtml("   ", 100)).isEqualTo("");
        }

        @Test @DisplayName("超过 maxLength 截断（防止大文本 OOM）")
        void shouldTruncateLongContent() {
            String longText = "a".repeat(100);
            String result = ArticleParser.cleanHtml(longText, 10);
            assertThat(result).hasSize(10);
        }

        @Test @DisplayName("折叠多余空白字符，保留词语间单个空格")
        void shouldCollapseWhitespace() {
            String html = "<p>Hello    World</p><p>Foo   Bar</p>";
            assertThat(ArticleParser.cleanHtml(html, 100)).isEqualTo("Hello World Foo Bar");
        }
    }

    // ==================== extractContent ====================

    @Nested @DisplayName("extractContent() 正文提取")
    class ExtractContent {

        @Test @DisplayName("优先提取 {@code <article>} 标签内的内容，排除 nav/footer 噪声")
        void shouldFindArticleTag() {
            Document doc = Jsoup.parse("""
                    <html><body>
                    <nav>导航</nav>
                    <article><p>正文内容</p></article>
                    <footer>页脚</footer>
                    </body></html>""");
            String content = ArticleParser.extractContent(doc);
            assertThat(content).contains("正文内容");
            assertThat(content).doesNotContain("导航").doesNotContain("页脚");
        }

        @Test @DisplayName("无 {@code <article>} 时识别 {@code .content / .post} 等常见 class 名")
        void shouldFindContentClass() {
            Document doc = Jsoup.parse("""
                    <html><body>
                    <div class="content"><p>文章正文</p></div>
                    </body></html>""");
            assertThat(ArticleParser.extractContent(doc)).contains("文章正文");
        }

        @Test @DisplayName("提取正文时保留段落边界，避免详情页展示为一整段文本")
        void shouldPreserveParagraphs() {
            Document doc = Jsoup.parse("""
                    <html><body>
                    <article>
                      <p>第一段正文。</p>
                      <p>第二段正文。</p>
                    </article>
                    </body></html>""");
            assertThat(ArticleParser.extractContent(doc)).isEqualTo("第一段正文。\n\n第二段正文。");
        }

        @Test @DisplayName("提取全文正文时不提前按 5000 字截断")
        void shouldKeepFullContentForSummaryPipeline() {
            String longText = "a".repeat(6000);
            Document doc = Jsoup.parse("<html><body><article><p>" + longText + "</p></article></body></html>");

            String content = ArticleParser.extractContent(doc);

            assertThat(content).hasSize(6000);
        }

        @Test @DisplayName("无已知选择器时回退到 {@code <body>} 并移除 aside/sidebar 等噪声")
        void shouldFallbackToBody() {
            Document doc = Jsoup.parse("""
                    <html><body>
                    <header>标题</header>
                    <p>正文段落</p>
                    <aside>侧边栏</aside>
                    </body></html>""");
            String content = ArticleParser.extractContent(doc);
            assertThat(content).contains("正文段落");
            assertThat(content).doesNotContain("侧边栏");
        }
    }

    // ==================== extractPublishedDate ====================

    @Nested @DisplayName("extractPublishedDate() 发布时间提取")
    class ExtractPublishedDate {

        @Test @DisplayName("优先读取 {@code <time datetime=\"...\">} 属性")
        void shouldFindTimeTag() {
            Document doc = Jsoup.parse("""
                    <html><body>
                    <article><time datetime="2026-06-10T08:00:00Z">2026-06-10</time></article>
                    </body></html>""");
            Instant date = ArticleParser.extractPublishedDate(doc);
            assertThat(date).isNotNull();
        }

        @Test @DisplayName("兼容 {@code <meta property=\"article:published_time\">} Open Graph 协议")
        void shouldFindMetaTag() {
            Document doc = Jsoup.parse("""
                    <html><head>
                    <meta property="article:published_time" content="2026-06-10T08:00:00Z">
                    </head><body><p>正文</p></body></html>""");
            Instant date = ArticleParser.extractPublishedDate(doc);
            assertThat(date).isNotNull();
        }

        @Test @DisplayName("页面不包含日期信息时返回 null，不抛出异常")
        void noDate_shouldReturnNull() {
            Document doc = Jsoup.parse("<html><body><p>无日期</p></body></html>");
            assertThat(ArticleParser.extractPublishedDate(doc)).isNull();
        }

        @Test @DisplayName("兼容正文中的中文发布日期，例如 日期：2026年6月5日")
        void shouldFindChineseDateInBodyText() {
            Document doc = Jsoup.parse("""
                    <html><body>
                    <article>作者：张三 日期：2026年6月5日 正文内容</article>
                    </body></html>""");
            Instant date = ArticleParser.extractPublishedDate(doc);
            assertThat(date).isNotNull();
        }
    }
}
