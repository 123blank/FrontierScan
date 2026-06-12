package com.frontierscan.llm.tag;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import com.frontierscan.llm.LlmProperties;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 领域分类器。
 * <p>
 * 通过 LLM 对可选领域列表进行相关性评分，返回评分最高的领域（最多 3 个）。
 * 使用专用的提示词模板 {@code domain-classifier.stg}，与摘要提示词独立。
 * </p>
 *
 * <p><b>流程：</b>
 * <ol>
 *   <li>加载模板，将 {@code {domain_list}} 替换为实际领域列表</li>
 *   <li>调用 LLM（复用 DashScope 兼容 API）</li>
 *   <li>解析 JSON 响应，按分数排序返回 top 3</li>
 * </ol>
 * LLM 未配置 API Key 时返回空列表，不中断采集流程。
 * </p>
 */
@Slf4j
@Component
public class DomainClassifier {

    private static final String PROMPT_TEMPLATE_PATH = "prompt_template/domain-classifier.stg";
    private static final String CHAT_ENDPOINT = "/chat/completions";
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(15);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(30);
    private static final int MAX_DOMAINS = 3;

    private static final String PH_DOMAIN_LIST = "{domain_list}";
    private static final String PH_TITLE = "{title}";
    private static final String PH_CONTENT = "{content}";
    private static final String USER_CONTENT_MARKER = "\n文章标题：";

    private final RestTemplate restTemplate;
    private final LlmProperties llmProperties;
    private final ObjectMapper objectMapper;

    /** 系统提示词模板，含 {@code {domain_list}} 占位符。 */
    private final String systemPromptTemplate;

    /** 用户消息模板，含 {@code {title}} 和 {@code {content}} 占位符。 */
    private final String userMessageTemplate;

    public DomainClassifier(RestTemplateBuilder builder, LlmProperties llmProperties, ObjectMapper objectMapper) {
        this.llmProperties = llmProperties;
        this.objectMapper = objectMapper;
        this.restTemplate = builder
                .defaultHeader("Content-Type", "application/json")
                .defaultHeader("Accept", "application/json")
                .setConnectTimeout(CONNECT_TIMEOUT)
                .setReadTimeout(READ_TIMEOUT)
                .build();

        String raw = loadPromptTemplate();
        int split = raw.indexOf(USER_CONTENT_MARKER);
        if (split > 0) {
            this.systemPromptTemplate = raw.substring(0, split).trim();
            this.userMessageTemplate = raw.substring(split + 1);
        } else {
            log.warn("Domain classifier template missing '{}' marker", USER_CONTENT_MARKER.trim());
            this.systemPromptTemplate = raw.trim();
            this.userMessageTemplate = "文章标题：{title}\n文章正文：{content}";
        }
    }

    /** 从 classpath 加载提示词模板文件。 */
    private String loadPromptTemplate() {
        try {
            ClassPathResource resource = new ClassPathResource(PROMPT_TEMPLATE_PATH);
            if (!resource.exists()) {
                throw new RuntimeException("Domain classifier template not found: " + PROMPT_TEMPLATE_PATH);
            }
            return new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("Failed to load domain classifier template", e);
        }
    }

    /**
     * 对可选领域列表进行相关性评分。
     *
     * @param domains    所有可用领域
     * @param title      文章标题
     * @param content    文章正文
     * @return 评分最高的领域列表（最多 {@value MAX_DOMAINS} 个），API Key 未配置时返回空列表
     */
    public List<ScoredDomain> classify(List<TagDomain> domains, String title, String content) {
        if (domains == null || domains.isEmpty()) {
            return List.of();
        }
        if (!resolveApiKey()) {
            return List.of();
        }

        String domainListStr = domains.stream()
                .map(TagDomain::getName)
                .collect(Collectors.joining(", "));

        String systemPrompt = systemPromptTemplate.replace(PH_DOMAIN_LIST, domainListStr);
        String userMessage = userMessageTemplate
                .replace(PH_TITLE, title != null ? title : "")
                .replace(PH_CONTENT, content != null ? content : "");

        try {
            Map<String, Object> body = Map.of(
                    "model", llmProperties.model(),
                    "messages", List.of(
                            Map.of("role", "system", "content", systemPrompt),
                            Map.of("role", "user", "content", userMessage)
                    ));

            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(llmProperties.apiKey());
            var requestEntity = new HttpEntity<>(body, headers);

            String url = llmProperties.baseUrl() + CHAT_ENDPOINT;
            String responseJson = restTemplate.postForObject(url, requestEntity, String.class);

            if (responseJson == null || responseJson.isBlank()) {
                log.warn("Domain classifier: LLM returned empty response");
                return List.of();
            }

            JsonNode root = objectMapper.readTree(responseJson);
            JsonNode choices = root.get("choices");
            if (choices == null || choices.isEmpty()) {
                return List.of();
            }

            String llmText = choices.get(0).get("message").get("content").asText();
            return parseResponse(llmText);

        } catch (Exception e) {
            log.warn("Domain classifier LLM call failed: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * 解析 LLM 返回的 JSON 评分结果。
     * <p>期望格式：[{"domain": "科技", "score": 9}, {"domain": "金融", "score": 3}]</p>
     */
    private List<ScoredDomain> parseResponse(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        // 清理可能的 markdown 代码块标记
        String cleaned = text.trim();
        if (cleaned.startsWith("```")) {
            int start = cleaned.indexOf('\n');
            int end = cleaned.lastIndexOf("```");
            if (start > 0 && end > start) {
                cleaned = cleaned.substring(start, end).trim();
            }
        }
        try {
            JsonNode arr = objectMapper.readTree(cleaned);
            if (!arr.isArray()) {
                return List.of();
            }
            List<ScoredDomain> results = new ArrayList<>();
            for (JsonNode item : arr) {
                String domain = item.get("domain").asText();
                int score = item.get("score").asInt();
                if (score > 0) {
                    results.add(new ScoredDomain(domain, score));
                }
            }
            // 按分数降序排列，取 top 3
            return results.stream()
                    .sorted((a, b) -> Integer.compare(b.score(), a.score()))
                    .limit(MAX_DOMAINS)
                    .toList();
        } catch (JsonProcessingException e) {
            log.warn("Failed to parse domain classifier response: {}", e.getMessage());
            return List.of();
        }
    }

    /** 检查 API Key 是否已配置。 */
    private boolean resolveApiKey() {
        String key = llmProperties.apiKey();
        if (key != null && !key.isBlank()) {
            return true;
        }
        String fallback = System.getenv("LLM_API_KEY");
        if (fallback != null && !fallback.isBlank()) {
            return true;
        }
        log.debug("LLM API key not configured; domain classifier skipped");
        return false;
    }
}
