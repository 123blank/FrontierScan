package com.frontierscan.llm.tag;

/**
 * 标签基本信息。
 * <p>
 * 从领域标签表（如 tech_tags）中查询出的标签数据，用于传递给 LLM 评分。
 * 包含标签 ID 和名称，不关心标签来自哪个领域。
 * </p>
 *
 * @param id   标签 ID
 * @param name 标签名称
 */
public record TagInfo(long id, String name) {
}
