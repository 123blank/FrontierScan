package com.frontierscan.llm;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.List;

/**
 * 长文摘要 Map-Reduce 编排服务。
 * <p>
 * Provider 仍然只负责“给定一段内容生成结构化摘要”，本服务负责在文章全文过长时拆分正文、
 * 保留 overlap 上下文、逐块摘要并最终聚合。这样可以让摘要基于采集全文，而不是被
 * {@code content_excerpt} 的列表展示片段限制，同时把 LLM 成本和上下文风险集中到配置中治理。
 * </p>
 */
@Slf4j
@Service
public class SummaryMapReduceService {

    private static final String PARAGRAPH_SEPARATOR = "\n\n";

    private final LlmProvider llmProvider;
    private final LlmProperties properties;

    public SummaryMapReduceService(LlmProvider llmProvider, LlmProperties properties) {
        this.llmProvider = llmProvider;
        this.properties = properties;
    }

    /**
     * 基于全文生成结构化摘要。
     * <p>
     * 未启用 Map-Reduce、正文较短或最终只有一个分块时，直接复用现有单次摘要调用。
     * 多分块时先逐块生成 map 摘要，再把所有分块结果汇总给 reduce 调用生成最终摘要。
     * </p>
     */
    public SummaryResult summarize(SummaryRequest request) {
        if (request == null || isBlank(request.content())) {
            return null;
        }
        LlmProperties.SummaryMapReduceProperties config = properties.summaryMapReduce();
        if (!config.enabledValue()) {
            return llmProvider.summarize(request);
        }

        List<String> chunks = splitContent(
                request.content(),
                config.chunkSizeCharsValue(),
                config.overlapCharsValue(),
                config.maxChunksValue());
        if (chunks.size() <= 1) {
            return llmProvider.summarize(request);
        }

        log.info("Summarizing article '{}' with Map-Reduce chunks={}", request.title(), chunks.size());
        List<SummaryResult> mappedResults = new ArrayList<>();
        for (int i = 0; i < chunks.size(); i++) {
            SummaryResult mapped = llmProvider.summarize(new SummaryRequest(
                    request.title(),
                    request.sourceUrl(),
                    buildMapContent(chunks.get(i), i + 1, chunks.size())));
            if (mapped == null || isBlank(mapped.summary())) {
                throw new SummaryMapReduceException(
                        "第 " + (i + 1) + "/" + chunks.size() + " 个分块摘要失败，已停止聚合以避免摘要缺失原文信息");
            }
            mappedResults.add(mapped);
        }

        return llmProvider.summarize(new SummaryRequest(
                request.title(),
                request.sourceUrl(),
                buildReduceContent(mappedResults)));
    }

    /**
     * 按配置拆分正文，并为相邻分块保留 overlap。
     * <p>
     * 优先在段落边界处分块；如果长段落本身超过 chunkSize，则退化为字符边界切分。
     * maxChunks 为 0 表示不限制分块数量，保证默认情况下完整覆盖全文。
     * </p>
     */
    List<String> splitContent(String content, int chunkSize, int overlap, int maxChunks) {
        if (isBlank(content)) {
            return List.of();
        }
        String normalized = content.trim();
        int effectiveChunkSize = Math.max(1, chunkSize);
        int effectiveOverlap = Math.min(Math.max(overlap, 0), Math.max(effectiveChunkSize - 1, 0));

        List<String> chunks = new ArrayList<>();
        int start = 0;
        while (start < normalized.length()) {
            int end = Math.min(start + effectiveChunkSize, normalized.length());
            if (end < normalized.length()) {
                int boundary = findSplitBoundary(normalized, start, end, effectiveChunkSize);
                if (boundary > start) {
                    end = boundary;
                }
            }

            String chunk = normalized.substring(start, end).trim();
            if (!chunk.isEmpty()) {
                chunks.add(chunk);
            }
            if (end >= normalized.length() || (maxChunks > 0 && chunks.size() >= maxChunks)) {
                break;
            }
            start = Math.max(end - effectiveOverlap, start + 1);
        }
        return chunks;
    }

    private static int findSplitBoundary(String content, int start, int end, int chunkSize) {
        int minimumBoundary = start + Math.max(1, chunkSize / 2);
        int paragraphBoundary = content.lastIndexOf(PARAGRAPH_SEPARATOR, end);
        if (paragraphBoundary > minimumBoundary) {
            return paragraphBoundary + PARAGRAPH_SEPARATOR.length();
        }
        int sentenceBoundary = Math.max(content.lastIndexOf("。", end), content.lastIndexOf(".", end));
        if (sentenceBoundary > minimumBoundary) {
            return sentenceBoundary + 1;
        }
        return end;
    }

    private static String buildMapContent(String chunk, int index, int total) {
        return "以下是同一篇文章全文的第 " + index + "/" + total + " 个分块。"
                + "请只总结本分块中的事实、观点和结论，保留与前后文衔接有关的信息。\n\n"
                + chunk;
    }

    private static String buildReduceContent(List<SummaryResult> mappedResults) {
        StringBuilder content = new StringBuilder("以下是同一篇文章按全文分块生成的中间摘要。"
                + "请基于所有分块结果合并为最终摘要，去重但不要遗漏重要信息。\n");
        for (int i = 0; i < mappedResults.size(); i++) {
            SummaryResult result = mappedResults.get(i);
            content.append("\n分块 ").append(i + 1).append("：\n");
            appendLine(content, "摘要", result.summary());
            appendLine(content, "关键要点", result.keyPoints() == null ? null : String.join("；", result.keyPoints()));
            appendLine(content, "标签", result.tags() == null ? null : String.join("，", result.tags()));
        }
        return content.toString();
    }

    private static void appendLine(StringBuilder content, String title, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        content.append(title).append("：").append(value.trim()).append('\n');
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
