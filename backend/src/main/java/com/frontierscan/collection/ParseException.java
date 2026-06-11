package com.frontierscan.collection;

/**
 * 解析异常。
 * <p>RSS/HTML 格式异常，可降级处理（例如 RSS 解析失败 → 尝试 HTML 采集）。</p>
 */
public class ParseException extends CollectorException {
    public ParseException(String sourceType, String siteUrl, String message) {
        super(sourceType, siteUrl, "PARSE_ERROR", message);
    }

    public ParseException(String sourceType, String siteUrl, String message, Throwable cause) {
        super(sourceType, siteUrl, "PARSE_ERROR", message, cause);
    }
}