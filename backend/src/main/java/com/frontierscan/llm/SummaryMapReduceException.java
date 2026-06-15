package com.frontierscan.llm;

/**
 * 摘要 Map-Reduce 分治链路异常。
 * <p>
 * 与普通 LLM 空返回不同，该异常表示长文分块摘要过程中出现了部分失败。
 * 采集治理层捕获后会把文章标记为 FAILED，避免使用不完整分块结果生成最终摘要。
 * </p>
 */
public class SummaryMapReduceException extends RuntimeException {
    public SummaryMapReduceException(String message) {
        super(message);
    }
}
