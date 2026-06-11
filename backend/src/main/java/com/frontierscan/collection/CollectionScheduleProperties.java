package com.frontierscan.collection;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 定时采集调度配置。
 * <p>
 * 绑定 {@code app.collection.*} 配置项，集中管理调度开关、扫描间隔和 Redis 锁过期时间。
 * 使用 record 保持配置对象不可变，避免运行期被业务代码误修改。
 * </p>
 *
 * <p><b>默认值策略：</b></p>
 * <ul>
 *   <li>{@code schedulerFixedDelayMs <= 0} 时回退为 60 秒，避免错误配置导致调度线程空转。</li>
 *   <li>{@code lockTtlMinutes <= 0} 时回退为 30 分钟，确保 Redis 锁总能自动释放。</li>
 * </ul>
 *
 * @param schedulerEnabled 是否启用定时调度
 * @param schedulerFixedDelayMs 调度扫描间隔，单位毫秒
 * @param lockTtlMinutes Redis 分布式锁过期时间，单位分钟
 */
@ConfigurationProperties(prefix = "app.collection")
public record CollectionScheduleProperties(
        boolean schedulerEnabled,
        long schedulerFixedDelayMs,
        long lockTtlMinutes
) {
    /**
     * 规范化配置值。
     * <p>
     * Spring Boot 会先完成外部配置绑定，再进入 compact constructor。
     * 这里对非法数值做兜底修正，保证调度器拿到的配置始终可用。
     * </p>
     */
    public CollectionScheduleProperties {
        if (schedulerFixedDelayMs <= 0) {
            schedulerFixedDelayMs = 60_000L;
        }
        if (lockTtlMinutes <= 0) {
            lockTtlMinutes = 30L;
        }
    }
}
