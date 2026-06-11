package com.frontierscan.collection;

import lombok.Getter;

/**
 * 采集过程基类异常。
 * <p>所有 Collector 抛出的异常继承此类，确保错误信息结构化。</p>
 */
@Getter
public class CollectorException extends RuntimeException {
    private final String sourceType;
    private final String siteUrl;
    private final String errorCode;

    public CollectorException(String sourceType, String siteUrl, String errorCode, String message) {
        super(message);
        this.sourceType = sourceType;
        this.siteUrl = siteUrl;
        this.errorCode = errorCode;
    }

    public CollectorException(String sourceType, String siteUrl, String errorCode, String message, Throwable cause) {
        super(message, cause);
        this.sourceType = sourceType;
        this.siteUrl = siteUrl;
        this.errorCode = errorCode;
    }
}