package com.frontierscan.llm;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link SummaryQualityEvaluator} 摘要质量规则评分测试。
 * <p>
 * 质量判断是摘要治理的核心业务规则，测试覆盖硬性失败和扣分场景，
 * 防止后续调整提示词或解析器时误把无效摘要标记为合格。
 * </p>
 */
@DisplayName("SummaryQualityEvaluator 摘要质量规则评分")
class SummaryQualityEvaluatorTest {

    private final SummaryQualityEvaluator evaluator = new SummaryQualityEvaluator();

    @Test
    @DisplayName("空摘要直接判定不合格")
    void shouldRejectEmptySummary() {
        SummaryQualityResult result = evaluator.evaluate(new SummaryResult(null, " ", List.of(), List.of()), "正文");

        assertThat(result.qualified()).isFalse();
        assertThat(result.score()).isZero();
        assertThat(result.reason()).contains("摘要为空");
    }

    @Test
    @DisplayName("包含模板占位符直接判定不合格")
    void shouldRejectPlaceholder() {
        SummaryQualityResult result = evaluator.evaluate(
                new SummaryResult(null, "这是一段包含 {content} 的摘要。", List.of("要点1", "要点2"), List.of("AI")),
                "正文");

        assertThat(result.qualified()).isFalse();
        assertThat(result.reason()).contains("占位符");
    }

    @Test
    @DisplayName("疑似原文截断直接判定不合格")
    void shouldRejectSourceExcerpt() {
        String source = "这是一段很长的原文内容，用于模拟采集器抽取出来的正文片段。"
                + "如果模型只是把原文开头直接截断返回，就不属于真正的摘要。"
                + "系统应该标记为低质量，提示用户重新生成。"
                + "这里继续补充一些技术背景，确保样本文本长度足够覆盖截断检测规则。";
        SummaryQualityResult result = evaluator.evaluate(
                new SummaryResult(null, source.substring(0, 90), List.of("要点1", "要点2"), List.of("AI")),
                source);

        assertThat(result.qualified()).isFalse();
        assertThat(result.reason()).contains("原文截断");
    }

    @Test
    @DisplayName("结构完整且长度合理的摘要判定合格")
    void shouldAcceptQualifiedSummary() {
        SummaryResult summary = new SummaryResult(
                "优化标题",
                "文章介绍了一种面向企业应用的模型治理方案，重点解决摘要稳定性和质量可见性问题。"
                        + "方案通过规则评分识别低质量摘要，并提供人工重新生成入口，从而降低错误摘要进入阅读链路的风险。",
                List.of("引入文章级摘要状态", "使用规则评分识别低质量摘要", "提供手动重新生成入口"),
                List.of("LLM", "摘要治理"));

        SummaryQualityResult result = evaluator.evaluate(summary, "原始正文内容");

        assertThat(result.qualified()).isTrue();
        assertThat(result.score()).isGreaterThanOrEqualTo(SummaryQualityEvaluator.PASS_SCORE);
        assertThat(result.reason()).isEqualTo("摘要质量合格");
    }

    @Test
    @DisplayName("过短且缺少结构信息的摘要判定低质量")
    void shouldMarkShortSummaryLowQuality() {
        SummaryQualityResult result = evaluator.evaluate(
                new SummaryResult(null, "介绍了模型治理。", List.of("要点1"), List.of()),
                "正文");

        assertThat(result.qualified()).isFalse();
        assertThat(result.score()).isLessThan(SummaryQualityEvaluator.PASS_SCORE);
        assertThat(result.reason()).contains("摘要过短", "关键要点不足", "标签为空");
    }
}
