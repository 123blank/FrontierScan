package com.frontierscan.llm;

import org.springframework.stereotype.Component;

import java.util.List;

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
