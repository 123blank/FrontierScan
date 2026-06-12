package com.frontierscan.llm.tag;

/**
 * 领域评分结果。
 * <p>
 * 由 {@link DomainClassifier} 返回，表示 LLM 对某个领域与文章内容相关性的评分。
 * 按 score 降序排列后取 top N。
 * </p>
 *
 * @param domain 领域名称
 * @param score  相关性分数（0-10）
 */
public record ScoredDomain(String domain, int score) {
}
