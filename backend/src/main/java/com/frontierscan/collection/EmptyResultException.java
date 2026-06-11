package com.frontierscan.collection;

/**
 * 空结果异常。
 * <p>已是最新、无新内容。非异常情况，标记任务为 COMPLETED(collectedCount=0)。</p>
 */
public class EmptyResultException extends CollectorException {
    public EmptyResultException(String sourceType, String siteUrl, String message) {
        super(sourceType, siteUrl, "EMPTY_RESULT", message);
    }
}