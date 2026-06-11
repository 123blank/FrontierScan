/**
 * 大模型集成模块，提供统一的 LLM Provider 抽象层。
 * <p>
 * 默认实现阿里 DashScope/Qwen Provider，设计上支持多 Provider 扩展。
 * 通过 {@link com.frontierscan.llm.LlmProvider} 接口解耦，配置支持 provider/apiKey/baseUrl/model 切换。
 * 当前骨架返回占位摘要，接入真实大模型后输出结构化摘要结果。
 * </p>
 */
package com.frontierscan.llm;