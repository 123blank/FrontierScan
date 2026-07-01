package com.frontierscan.article;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 文章摘要自动恢复配置。
 * <p>
 * 采集增强阶段不是持久化队列；服务重启、批量超时或线程中断时，文章可能已经入库但摘要仍停留在
 * PENDING。本配置控制后台恢复器如何扫描这些滞留文章并重新投递摘要。
 * </p>
 *
 * @param enabled 恢复器开关
 * @param fixedDelayMs 扫描间隔，单位毫秒
 * @param staleAfterMinutes PENDING 超过多少分钟后视为可恢复
 * @param batchSize 单轮最多恢复文章数
 */
@ConfigurationProperties(prefix = "app.summary-recovery")
public record ArticleSummaryRecoveryProperties(
        boolean enabled,
        long fixedDelayMs,
        long staleAfterMinutes,
        int batchSize
) {
    public ArticleSummaryRecoveryProperties {
        fixedDelayMs = fixedDelayMs > 0 ? fixedDelayMs : 300_000;
        staleAfterMinutes = staleAfterMinutes > 0 ? staleAfterMinutes : 10;
        batchSize = batchSize > 0 ? batchSize : 10;
    }

    public boolean enabledValue() {
        return enabled;
    }

    public long fixedDelayMsValue() {
        return fixedDelayMs;
    }

    public long staleAfterMinutesValue() {
        return staleAfterMinutes;
    }

    public int batchSizeValue() {
        return batchSize;
    }
}
