package com.frontierscan.collection;

/**
 * 采集失败分类工具。
 * <p>
 * 将采集器抛出的技术异常归一为稳定的业务失败类型，避免前端和运维页面依赖异常文案。
 * 新增失败场景时优先扩展这里的常量和映射逻辑，保持任务记录页展示口径一致。
 * </p>
 */
final class CollectionFailureClassifier {

    /** 网络连接或读取超时。 */
    static final String NETWORK_TIMEOUT = "NETWORK_TIMEOUT";

    /** RSS/Atom Feed 解析失败。 */
    static final String RSS_PARSE_ERROR = "RSS_PARSE_ERROR";

    /** HTML 页面抓取或解析失败。 */
    static final String HTML_PARSE_ERROR = "HTML_PARSE_ERROR";

    /** 成功访问但无法解析出任何可采集候选内容。 */
    static final String EMPTY_RESULT = "EMPTY_RESULT";

    /** LLM 摘要失败，默认作为非阻断告警记录。 */
    static final String LLM_SUMMARY_FAILED = "LLM_SUMMARY_FAILED";

    /** 标签评估失败，作为非阻断告警记录。 */
    static final String TAG_EVALUATION_FAILED = "TAG_EVALUATION_FAILED";

    /** 未能归类的异常。 */
    static final String UNKNOWN = "UNKNOWN";

    /** RSS 采集阶段。 */
    static final String STAGE_RSS = "RSS";

    /** HTML 采集阶段。 */
    static final String STAGE_HTML = "HTML";

    /** LLM 摘要阶段。 */
    static final String STAGE_LLM_SUMMARY = "LLM_SUMMARY";

    /** 未知阶段。 */
    static final String STAGE_UNKNOWN = "UNKNOWN";

    /**
     * 根据采集器异常生成稳定失败类型。
     *
     * @param exception 采集器异常
     * @return 对外展示和测试断言使用的失败类型
     */
    static String failureType(CollectorException exception) {
        if (exception instanceof EmptyResultException) {
            return EMPTY_RESULT;
        }
        if (exception instanceof ConnectionTimeoutException) {
            return NETWORK_TIMEOUT;
        }
        if (exception instanceof ParseException) {
            return STAGE_RSS.equals(exception.getSourceType()) ? RSS_PARSE_ERROR : HTML_PARSE_ERROR;
        }
        if ("CONNECTION_TIMEOUT".equals(exception.getErrorCode())) {
            return NETWORK_TIMEOUT;
        }
        if ("PARSE_ERROR".equals(exception.getErrorCode())) {
            return STAGE_RSS.equals(exception.getSourceType()) ? RSS_PARSE_ERROR : HTML_PARSE_ERROR;
        }
        if ("EMPTY_RESULT".equals(exception.getErrorCode())) {
            return EMPTY_RESULT;
        }
        return UNKNOWN;
    }

    /**
     * 根据采集器异常生成失败阶段。
     *
     * @param exception 采集器异常
     * @return RSS、HTML 或 UNKNOWN
     */
    static String failureStage(CollectorException exception) {
        String sourceType = exception.getSourceType();
        if (STAGE_RSS.equals(sourceType) || STAGE_HTML.equals(sourceType)) {
            return sourceType;
        }
        return STAGE_UNKNOWN;
    }

    private CollectionFailureClassifier() {}
}
