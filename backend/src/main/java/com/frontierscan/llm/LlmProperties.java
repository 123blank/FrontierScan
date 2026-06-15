package com.frontierscan.llm;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 大模型配置属性，前缀 {@code app.llm}。
 * <p>
 * 从配置文件（application.yml 或环境变量）读取 LLM Provider 相关的配置。
 * 支持通过环境变量覆盖默认值，方便 Docker 部署时动态配置。
 * </p>
 *
 * @param provider LLM Provider 名称（默认 dashscope）
 * @param baseUrl  API 基础地址（默认 DashScope 兼容地址）
 * @param apiKey   API 密钥（留空时 LLM 功能不可用，系统降级运行）
 * @param model    模型名称（默认 qwen-plus）
 */
@ConfigurationProperties(prefix = "app.llm")
public record LlmProperties(
        String provider,
        String baseUrl,
        String apiKey,
        String model,
        SummaryMapReduceProperties summaryMapReduce,
        TagProperties tag
) {
    /**
     * 摘要 Map-Reduce 分治配置。
     * <p>
     * 数据库会保存采集到的清洗后全文，但直接把超长正文一次性发送给大模型容易触发上下文限制或成本波动。
     * 这里通过可配置的 chunk/overlap/maxChunks 控制分治策略：chunkSizeChars 决定单段正文长度，
     * overlapChars 保留相邻分块的上下文衔接，maxChunks 为 0 时表示不限制分块数量以覆盖全文。
     * </p>
     */
    public SummaryMapReduceProperties summaryMapReduce() {
        return summaryMapReduce == null
                ? new SummaryMapReduceProperties(true, 6000, 500, 0)
                : summaryMapReduce;
    }

    /**
     * 标签评估输入配置。
     * <p>标签一期不做全文 Map-Reduce，只把全文作为摘要和关键要点之后的语义兜底，因此需要单独限制输入长度。</p>
     */
    public TagProperties tag() {
        return tag == null ? new TagProperties(8000) : tag;
    }

    public record SummaryMapReduceProperties(
            Boolean enabled,
            Integer chunkSizeChars,
            Integer overlapChars,
            Integer maxChunks
    ) {
        public boolean enabledValue() {
            return enabled == null || enabled;
        }

        public int chunkSizeCharsValue() {
            return chunkSizeChars == null || chunkSizeChars <= 0 ? 6000 : chunkSizeChars;
        }

        public int overlapCharsValue() {
            return overlapChars == null || overlapChars < 0 ? 500 : overlapChars;
        }

        public int maxChunksValue() {
            return maxChunks == null || maxChunks < 0 ? 0 : maxChunks;
        }
    }

    public record TagProperties(Integer maxContentChars) {
        public int maxContentCharsValue() {
            return maxContentChars == null || maxContentChars <= 0 ? 8000 : maxContentChars;
        }
    }
}
