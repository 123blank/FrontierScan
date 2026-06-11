package com.frontierscan.llm;

public record SummaryRequest(
        String title,
        String sourceUrl,
        String content
) {
}
