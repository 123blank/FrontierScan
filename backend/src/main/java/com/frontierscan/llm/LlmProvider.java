package com.frontierscan.llm;

public interface LlmProvider {
    String providerName();

    SummaryResult summarize(SummaryRequest request);
}
