package com.frontierscan.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * FrontierScan 异步任务执行器配置。
 * <p>
 * 按企业级可观测性要求拆分采集、摘要、长文 Map 分块和标签评估线程池，避免不同类型的任务互相抢占资源。
 * 线程名前缀统一使用 {@code frontierscan-模块-能力-} 格式，便于日志、线程 dump 和生产排障快速定位。
 * 所有线程池均使用 {@link ThreadPoolExecutor.CallerRunsPolicy}，当队列已满时由调用线程执行，形成自然回压且不丢任务。
 * </p>
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    /**
     * 采集任务线程池。
     * <p>用于 {@code @Async("frontierScanCollectionExecutor")} 标注的采集任务，避免阻塞 Web 请求线程。</p>
     */
    @Bean("frontierScanCollectionExecutor")
    public Executor frontierScanCollectionExecutor() {
        return buildExecutor(2, 4, 10, "frontierscan-collection-");
    }

    /**
     * 文章级摘要线程池。
     * <p>
     * 用于多篇文章之间的摘要并发。单篇长文内部的 Map 分块不使用该线程池，
     * 防止一篇超长文章占满所有文章级摘要并发额度。
     * </p>
     */
    @Bean("frontierScanLlmSummaryExecutor")
    public Executor frontierScanLlmSummaryExecutor() {
        return buildExecutor(2, 4, 100, "frontierscan-llm-summary-");
    }

    /**
     * 长文 Map-Reduce 分块摘要线程池。
     * <p>仅用于同一篇文章内部的 Map 分块并发；Reduce 汇总仍保持串行，确保最终摘要基于完整分块结果。</p>
     */
    @Bean("frontierScanLlmMapReduceExecutor")
    public Executor frontierScanLlmMapReduceExecutor() {
        return buildExecutor(2, 4, 100, "frontierscan-llm-map-");
    }

    /**
     * 标签评估线程池。
     * <p>单篇文章内部“领域评分 -> 标签评分”存在数据依赖，保持串行；多篇文章之间通过该线程池并发。</p>
     */
    @Bean("frontierScanLlmTagExecutor")
    public Executor frontierScanLlmTagExecutor() {
        return buildExecutor(1, 3, 100, "frontierscan-llm-tag-");
    }

    private static Executor buildExecutor(int corePoolSize, int maxPoolSize, int queueCapacity, String threadNamePrefix) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(corePoolSize);
        executor.setMaxPoolSize(maxPoolSize);
        executor.setQueueCapacity(queueCapacity);
        executor.setThreadNamePrefix(threadNamePrefix);
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}
