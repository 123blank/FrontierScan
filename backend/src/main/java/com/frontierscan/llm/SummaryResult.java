package com.frontierscan.llm;

import java.util.List;

/**
 * 大模型摘要处理结果。
 * <p>
 * LLM 对文章进行分析后输出的结构化信息，包含优化后的标题、
 * 3-5 句摘要、关键要点列表和自动提取的标签。
 * </p>
 *
 * @param optimizedTitle 大模型优化后的标题
 * @param summary        3-5 句摘要文本
 * @param keyPoints      关键要点列表
 * @param tags           自动提取的标签列表
 */
public record SummaryResult(
        String optimizedTitle,
        String summary,
        List<String> keyPoints,
        List<String> tags
) {
}