package com.frontierscan.llm;

/**
 * 大模型 Provider 抽象接口。
 * <p>
 * 设计用于支持多种 LLM Provider 的切换和扩展。
 * 默认实现为阿里 DashScope/Qwen Provider。
 * 后续扩展只需实现此接口即可接入新模型。
 * </p>
 *
 * @see DashScopeLlmProvider
 */
public interface LlmProvider {

    /** 返回 Provider 名称（如 "dashscope"）。 */
    String providerName();

    /**
     * 对文章内容进行摘要处理。
     *
     * @param request 摘要请求（包含标题、原文 URL 和正文内容）
     * @return 结构化摘要结果（优化标题、摘要、要点、标签）
     */
    SummaryResult summarize(SummaryRequest request);
}