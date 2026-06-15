package com.frontierscan.article;

/**
 * 文章级摘要治理状态常量。
 * <p>
 * 项目当前实体字段以字符串落库为主，因此这里使用常量类集中管理状态值，
 * 避免 Controller、Service、前端联调时出现拼写漂移。
 * </p>
 */
public final class ArticleSummaryStatus {

    /** 新文章已入库但尚未完成 LLM 摘要生成。 */
    public static final String PENDING = "PENDING";
    /** 摘要生成成功，且规则质量评分达到合格阈值。 */
    public static final String COMPLETED = "COMPLETED";
    /** LLM 未返回可用摘要、正文缺失或调用异常。 */
    public static final String FAILED = "FAILED";
    /** LLM 返回了摘要内容，但规则评分低于合格阈值，需要人工决定是否重试。 */
    public static final String LOW_QUALITY = "LOW_QUALITY";

    private ArticleSummaryStatus() {
    }
}
