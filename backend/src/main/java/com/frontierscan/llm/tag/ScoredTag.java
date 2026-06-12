package com.frontierscan.llm.tag;

/**
 * 标签评分结果。
 * <p>
 * 由 {@link LlmTagScorer} 返回，表示 LLM 对某个标签与文章内容相关性的评分。
 * 按 score 降序排列后取 top 3 作为文章的最终标签。
 * </p>
 *
 * @param tagName 标签名称
 * @param score   相关性分数（1-10）
 */
public record ScoredTag(String tagName, int score) {
}
