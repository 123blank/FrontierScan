package com.frontierscan.common.api;

import com.frontierscan.llm.LlmProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 服务健康检测与信息查询端点。
 * <p>
 * 提供轻量级的心跳检测接口，返回服务名称、运行状态和已配置的 LLM Provider 信息。
 * 该端点无需认证，可用于 Docker Compose 的健康检查和运维监控。
 * </p>
 */
@RestController
@RequestMapping("/api")
public class PingController {

    private final LlmProperties llmProperties;

    public PingController(LlmProperties llmProperties) {
        this.llmProperties = llmProperties;
    }

    /**
     * 服务心跳检测。
     *
     * @return 包含服务名称、状态和 LLM Provider 配置的响应
     */
    @GetMapping("/ping")
    public ApiResponse<Map<String, String>> ping() {
        return ApiResponse.ok(Map.of(
                "service", "frontierscan-backend",
                "status", "ready",
                "llmProvider", llmProperties.provider()
        ));
    }
}