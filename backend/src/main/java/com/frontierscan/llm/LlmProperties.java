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
        String model
) {
}