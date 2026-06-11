package com.frontierscan.llm;

import java.util.List;

public record SummaryResult(
        String optimizedTitle,
        String summary,
        List<String> keyPoints,
        List<String> tags
) {
}
