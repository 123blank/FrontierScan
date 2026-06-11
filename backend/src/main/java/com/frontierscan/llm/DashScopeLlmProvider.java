package com.frontierscan.llm;

import org.springframework.stereotype.Component;
import java.util.List;

/**
 * 阿里 DashScope / Qwen 大模型 Provider 实现。
 * <p>
 * 当前为骨架实现，返回占位摘要。
 * 接入真实 DashScope API 后，将通过 HTTP 调用 Qwen 模型进行文章摘要、
 * 标签提取和要点整理，输出结构化的 {@link SummaryResult}。
 * </p>
 */
@Component
public class DashScopeLlmProvider implements LlmProvider {

    private final LlmProperties properties;

    public DashScopeLlmProvider(LlmProperties properties) {
        this.properties = properties;
    }

    @Override
    public String providerName() {
        return properties.provider();
    }

    /**
     * 对文章内容进行摘要处理。
     * <p>
     * 当前返回占位结果。TODO: 接入 DashScope API 进行真实的大模型调用。
     * 预留了 title、sourceUrl 和 content 参数，后续实现 HTTP 请求逻辑。
     * </p>
     *
     * @param request 摘要请求
     * @return 摘要结果（当前为占位数据）
     */
    @Override
    public SummaryResult summarize(SummaryRequest request) {
        return new SummaryResult(
                request.title(),
                "LLM summary is not implemented in the skeleton.",
                List.of("Provider abstraction is ready.", "DashScope configuration is available."),
                List.of("skeleton")
        );
    }
}