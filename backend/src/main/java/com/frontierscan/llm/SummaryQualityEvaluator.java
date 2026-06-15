package com.frontierscan.llm;

import org.springframework.stereotype.Component;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * LLM 摘要质量规则评分器。
 * <p>
 * 一期摘要治理不引入 LLM 二次评审，避免额外成本和响应时间波动。
 * 该评分器只使用稳定、可测试的规则判断摘要是否适合直接展示：
 * 空摘要、模板占位符、模型原始格式污染和疑似原文截断属于硬性不合格；
 * 长度、句子数量、要点、标签和重复度通过扣分方式综合评估。
 * </p>
 */
@Component
public class SummaryQualityEvaluator {

    /** 低于该分数的摘要会标记为 LOW_QUALITY，但仍保留内容供用户判断。 */
    public static final int PASS_SCORE = 70;

    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("(<[^>]+>|\\{title}|\\{content})");
    private static final Pattern RAW_SECTION_PATTERN = Pattern.compile("(优化标题[:：].*摘要[:：].*要点[:：].*标签[:：])", Pattern.DOTALL);
    private static final Pattern SENTENCE_SPLITTER = Pattern.compile("[。！？!?；;\\n]+");

    /**
     * 对结构化摘要结果进行规则评分。
     *
     * @param result        LLM 返回的结构化摘要
     * @param sourceContent 原始正文片段，用于识别“直接截断原文当摘要”的低质量兜底
     * @return 质量评分结果
     */
    public SummaryQualityResult evaluate(SummaryResult result, String sourceContent) {
        if (result == null || isBlank(result.summary())) {
            return new SummaryQualityResult(0, false, "摘要为空");
        }

        String summary = result.summary().trim();
        if (PLACEHOLDER_PATTERN.matcher(summary).find()) {
            return new SummaryQualityResult(0, false, "摘要包含模板占位符");
        }
        if (RAW_SECTION_PATTERN.matcher(summary).find()) {
            return new SummaryQualityResult(0, false, "摘要包含模型原始格式，疑似解析失败");
        }
        if (isLikelySourceExcerpt(summary, sourceContent)) {
            return new SummaryQualityResult(0, false, "摘要疑似原文截断，未形成总结");
        }

        int score = 100;
        List<String> reasons = new ArrayList<>();

        int length = summary.length();
        if (length < 40) {
            score -= 30;
            reasons.add("摘要过短");
        }
        if (length > 500) {
            score -= 20;
            reasons.add("摘要过长");
        }

        if (sentenceCount(summary) < 2) {
            score -= 15;
            reasons.add("句子数量不足");
        }
        if (result.keyPoints() == null || result.keyPoints().size() < 2) {
            score -= 15;
            reasons.add("关键要点不足");
        }
        if (result.tags() == null || result.tags().isEmpty()) {
            score -= 10;
            reasons.add("标签为空");
        }
        if (hasRepeatedSentences(summary)) {
            score -= 20;
            reasons.add("存在重复句子");
        }
        if (containsInvalidFallback(summary)) {
            score -= 30;
            reasons.add("包含无效兜底表达");
        }

        score = Math.max(0, score);
        boolean qualified = score >= PASS_SCORE;
        String reason = reasons.isEmpty() ? "摘要质量合格" : String.join("，", reasons);
        return new SummaryQualityResult(score, qualified, reason);
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    /**
     * 判断摘要是否像“原文片段截断”而非总结。
     * <p>规则保持保守：只有摘要较长且与正文开头高度重合时才硬性判定，避免误伤正常技术摘要。</p>
     */
    private static boolean isLikelySourceExcerpt(String summary, String sourceContent) {
        if (isBlank(sourceContent) || summary.length() < 80) {
            return false;
        }
        String normalizedSummary = normalize(summary);
        String normalizedSource = normalize(sourceContent);
        if (normalizedSource.equals(normalizedSummary)) {
            return true;
        }
        int compareLength = Math.min(normalizedSummary.length(), 160);
        if (compareLength < 80 || normalizedSource.length() < compareLength) {
            return false;
        }
        return normalizedSource.startsWith(normalizedSummary.substring(0, compareLength));
    }

    private static int sentenceCount(String summary) {
        int count = 0;
        for (String sentence : SENTENCE_SPLITTER.split(summary)) {
            if (!sentence.trim().isEmpty()) {
                count++;
            }
        }
        return count;
    }

    private static boolean hasRepeatedSentences(String summary) {
        Set<String> seen = new HashSet<>();
        for (String sentence : SENTENCE_SPLITTER.split(summary)) {
            String normalized = normalize(sentence);
            if (normalized.length() < 12) {
                continue;
            }
            if (!seen.add(normalized)) {
                return true;
            }
        }
        return false;
    }

    private static boolean containsInvalidFallback(String summary) {
        String normalized = summary.toLowerCase(Locale.ROOT);
        return normalized.contains("无法判断")
                || normalized.contains("无法总结")
                || normalized.contains("没有提供内容")
                || normalized.contains("无法提供摘要");
    }

    private static String normalize(String value) {
        return value == null ? "" : value.replaceAll("\\s+", "").trim();
    }
}
