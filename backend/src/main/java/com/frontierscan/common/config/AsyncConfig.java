package com.frontierscan.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * 异步任务执行器配置。
 * <p>
 * 为不同类型的异步任务提供独立的线程池，避免资源竞争：
 * <ul>
 *   <li>{@code collectionTaskExecutor}：采集任务，核心 2、最大 4、队列 10</li>
 *   <li>{@code llmTaskExecutor}：LLM API 调用，核心 2、最大 5、队列 100</li>
 * </ul>
 * 两个线程池均使用 CallerRunsPolicy 拒绝策略，确保任务不丢失。
 * </p>
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    /**
     * 采集任务线程池。
     * <p>用于 {@code @Async("collectionTaskExecutor")} 标注的采集任务。
     * 避免阻塞 Web 请求线程，核心 2、最大 4、队列 10。</p>
     */
    @Bean("collectionTaskExecutor")
    public Executor collectionTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(10);
        executor.setThreadNamePrefix("collect-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }

    /**
     * LLM API 调用线程池。
     * <p>
     * 用于大模型 API 的并发调用。核心 2、最大 5，最多 5 篇文章同时请求 LLM。
     * 队列容量 100，CallerRunsPolicy 确保提交不失败（队列满时由调用线程执行）。
     * 线程名前缀 {@code llm-} 便于日志区分。
     * </p>
     */
    @Bean("llmTaskExecutor")
    public Executor llmTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(5);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("llm-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}