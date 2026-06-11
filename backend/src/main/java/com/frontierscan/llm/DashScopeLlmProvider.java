package com.frontierscan.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 阿里 DashScope / Qwen 大模型 Provider 实现。
 * <p>
 * 通过 DashScope 兼容的 OpenAI 风格 Chat API，对文章内容进行结构化摘要分析。
 * 输出包含优化标题、3-5 句摘要、关键要点列表和自动提取的标签。
 * </p>
 *
 * <p><b>API 调用说明：</b>
 * <ul>
 *   <li>端点：{@code POST /chat/completions}（OpenAI 兼容模式）</li>
 *   <li>模型：{@code app.llm.model} 配置（默认 {@code qwen-plus}）</li>
 *   <li>超时：连接 15 秒，读取 30 秒</li>
 *   <li>降级：API Key 未配置或调用失败时返回 {@code null}，不影响采集主流程</li>
 * </ul>
 * </p>
 *
 * <p><b>提示词模板：</b>
 * 模板文件 {@code classpath:prompt_template/article-zh-llm-summary-prompt.stg} 加载后，
 * 在 {@code 文章标题：} 处自动拆分为 System 角色（指令）和 User 角色（数据）。
 * 模板文件与代码分离，便于非开发人员调优提示词。</p>
 *
 * <p><b>输出解析：</b>
 * LLM 被要求以固定格式输出结构化文本，通过正则表达式解析为 {@link SummaryResult}：
 * <pre>
 * 优化标题：xxx
 * 摘要：xxx
 * 要点：
 * - xxx
 * - xxx
 * 标签：xxx, xxx
 * </pre>
 * 解析失败时将截断的原文作为摘要返回，避免原始 LLM 输出污染数据库。</p>
 */
@Slf4j
@Component
public class DashScopeLlmProvider implements LlmProvider {

    private static final String PROMPT_TEMPLATE_PATH = "prompt_template/article-zh-llm-summary-prompt.stg";
    private static final String CHAT_ENDPOINT = "/chat/completions";
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(15);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(30);

    /** 正则：解析 LLM 结构化输出。 */
    private static final Pattern RESPONSE_PATTERN = Pattern.compile(
            "优化标题[：:]\\s*(.*?)\\s*" +
            "摘要[：:]\\s*(.*?)\\s*" +
            "要点[：:]\\s*(.*?)\\s*" +
            "标签[：:]\\s*(.*)",
            Pattern.DOTALL);

    /** 解析失败时摘要的截断长度。 */
    private static final int FALLBACK_SUMMARY_MAX_LENGTH = 500;

    /** 模板中 System/User 的分割标记。标记之前为 System 指令，标记及之后为 User 消息格式。 */
    private static final String USER_CONTENT_MARKER = "\n文章标题：";

    private static final String PH_TITLE = "{title}";
    private static final String PH_CONTENT = "{content}";

    private final RestTemplate restTemplate;
    private final LlmProperties properties;
    private final ObjectMapper objectMapper;

    /** System 角色提示词（指令、输出格式约束）。 */
    private final String systemPrompt;

    /** User 消息模板，含 {title} 和 {content} 占位符。 */
    private final String userMessageTemplate;

    public DashScopeLlmProvider(RestTemplateBuilder builder, LlmProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.objectMapper = mapper;
        this.restTemplate = builder
                .defaultHeader("Content-Type", "application/json")
                .defaultHeader("Accept", "application/json")
                .setConnectTimeout(CONNECT_TIMEOUT)
                .setReadTimeout(READ_TIMEOUT)
                .build();

        // 加载模板并拆分为 System + User 两部分
        String raw = loadPromptTemplate();
        int split = raw.indexOf(USER_CONTENT_MARKER);
        if (split > 0) {
            this.systemPrompt = raw.substring(0, split).trim();
            this.userMessageTemplate = raw.substring(split + 1); // 保留 "\n文章标题："
        } else {
            log.warn("Prompt template missing '{}' marker; treating entire file as system prompt", USER_CONTENT_MARKER.trim());
            this.systemPrompt = raw.trim();
            this.userMessageTemplate = "文章标题：{title}\n文章正文：{content}";
        }
    }

    /** 从 classpath 加载提示词模板文件。 */
    private String loadPromptTemplate() {
        try {
            ClassPathResource resource = new ClassPathResource(PROMPT_TEMPLATE_PATH);
            if (!resource.exists()) {
                throw new RuntimeException("提示词模板文件不存在: " + PROMPT_TEMPLATE_PATH);
            }
            return new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("加载提示词模板文件失败: " + PROMPT_TEMPLATE_PATH, e);
        }
    }

    @Override
    public String providerName() {
        return properties.provider();
    }

    @Override
    public SummaryResult summarize(SummaryRequest request) {
        String apiKey = resolveApiKey();
        if (apiKey == null) {
            return null;
        }
        String content = request.content();
        if (content == null || content.isBlank()) {
            log.debug("Skipping LLM summary for empty content: {}", request.title());
            return null;
        }

        String userMessage = userMessageTemplate
                .replace(PH_TITLE, request.title() != null ? request.title() : "")
                .replace(PH_CONTENT, content);

        try {
            Map<String, Object> body = Map.of(
                    "model", properties.model(),
                    "messages", List.of(
                            Map.of("role", "system", "content", systemPrompt),
                            Map.of("role", "user", "content", userMessage)
                    ));

            var headers = new org.springframework.http.HttpHeaders();
            headers.setBearerAuth(apiKey);
            var requestEntity = new org.springframework.http.HttpEntity<>(body, headers);

            String url = properties.baseUrl() + CHAT_ENDPOINT;
            String responseJson = restTemplate.postForObject(url, requestEntity, String.class);

            if (responseJson == null || responseJson.isBlank()) {
                log.warn("LLM returned empty response for article: {}", request.title());
                return null;
            }

            JsonNode root = objectMapper.readTree(responseJson);
            JsonNode choices = root.get("choices");
            if (choices == null || choices.isEmpty()) {
                log.warn("LLM response has no choices: {}", responseJson);
                return null;
            }

            String llmText = choices.get(0).get("message").get("content").asText();
            return parseResponse(llmText);

        } catch (org.springframework.web.client.ResourceAccessException e) {
            log.error("LLM API connection timeout after {}ms: {}", READ_TIMEOUT.toMillis(), e.getMessage());
            return null;
        } catch (Exception e) {
            log.error("LLM API call failed for article '{}': {}", request.title(), e.getMessage());
            return null;
        }
    }

    /**
     * 解析环境变量：优先 {@code DASHSCOPE_API_KEY}，兼容 {@code LLM_API_KEY}。
     * 两者均未配置时日志警告并返回 {@code null}。
     */
    private String resolveApiKey() {
        String key = properties.apiKey();
        if (key != null && !key.isBlank()) {
            return key;
        }
        // 尝试从系统环境变量读取（兼容旧名称 LLM_API_KEY）
        String fallback = System.getenv("LLM_API_KEY");
        if (fallback != null && !fallback.isBlank()) {
            log.info("Using LLM_API_KEY as fallback (prefer DASHSCOPE_API_KEY)");
            return fallback;
        }
        log.warn("LLM API key not configured. Set DASHSCOPE_API_KEY in environment or .env file.");
        return null;
    }

    /**
     * 解析 LLM 结构化输出。
     * <p>正则解析失败时将原文截断后作为摘要返回，避免非结构化数据污染数据库。</p>
     */
    private SummaryResult parseResponse(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        var matcher = RESPONSE_PATTERN.matcher(text);
        if (!matcher.matches()) {
            log.warn("Failed to parse LLM response (len={}), using truncated fallback", text.length());
            String truncated = text.length() > FALLBACK_SUMMARY_MAX_LENGTH
                    ? text.substring(0, FALLBACK_SUMMARY_MAX_LENGTH) + "..."
                    : text;
            return new SummaryResult(null, truncated, List.of(), List.of());
        }

        String title = matcher.group(1).trim();
        String summary = matcher.group(2).trim();
        String keyPointsRaw = matcher.group(3).trim();
        String tagsRaw = matcher.group(4).trim();

        List<String> keyPoints = new ArrayList<>();
        for (String line : keyPointsRaw.split("\n")) {
            String cleaned = line.replaceAll("^[-\\d.、\\s]+", "").trim();
            if (!cleaned.isEmpty()) {
                keyPoints.add(cleaned);
            }
        }

        List<String> tags = new ArrayList<>();
        for (String tag : tagsRaw.split("[,，]")) {
            String cleaned = tag.trim();
            if (!cleaned.isEmpty()) {
                tags.add(cleaned);
            }
        }

        return new SummaryResult(
                title.isEmpty() ? null : title,
                summary.isEmpty() ? null : summary,
                keyPoints.isEmpty() ? List.of() : keyPoints,
                tags.isEmpty() ? List.of() : tags
        );
    }
}