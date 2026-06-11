package com.frontierscan.common.api;

import com.frontierscan.llm.LlmProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class PingController {

    private final LlmProperties llmProperties;

    public PingController(LlmProperties llmProperties) {
        this.llmProperties = llmProperties;
    }

    @GetMapping("/ping")
    public ApiResponse<Map<String, String>> ping() {
        return ApiResponse.ok(Map.of(
                "service", "frontierscan-backend",
                "status", "ready",
                "llmProvider", llmProperties.provider()
        ));
    }
}
