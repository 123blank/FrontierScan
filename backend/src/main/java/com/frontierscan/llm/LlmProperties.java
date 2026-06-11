package com.frontierscan.llm;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.llm")
public record LlmProperties(
        String provider,
        String baseUrl,
        String apiKey,
        String model
) {
}
