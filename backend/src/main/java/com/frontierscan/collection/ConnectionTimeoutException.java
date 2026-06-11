package com.frontierscan.collection;

/**
 * 连接超时异常。
 * <p>网站不可达或响应超时。致命异常，直接标记任务为 FAILED。</p>
 */
public class ConnectionTimeoutException extends CollectorException {
    public ConnectionTimeoutException(String sourceType, String siteUrl, String message) {
        super(sourceType, siteUrl, "CONNECTION_TIMEOUT", message);
    }

    public ConnectionTimeoutException(String sourceType, String siteUrl, String message, Throwable cause) {
        super(sourceType, siteUrl, "CONNECTION_TIMEOUT", message, cause);
    }
}