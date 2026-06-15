package com.frontierscan.llm;

/**
 * 摘要质量规则评分结果。
 *
 * @param score     0-100 的规则评分，低于阈值时视为低质量
 * @param qualified 是否达到可直接展示的质量门槛
 * @param reason    面向用户和排障展示的中文原因
 */
public record SummaryQualityResult(
        int score,
        boolean qualified,
        String reason
) {
}
