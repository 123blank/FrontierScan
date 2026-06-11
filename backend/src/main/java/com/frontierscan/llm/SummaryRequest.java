package com.frontierscan.llm;

/**
 * 大模型摘要请求参数。
 *
 * @param title    文章标题
 * @param sourceUrl 原文地址
 * @param content  文章正文内容
 */
public record SummaryRequest(
        String title,
        String sourceUrl,
        String content
) {
}