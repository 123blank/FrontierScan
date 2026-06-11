package com.frontierscan.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import java.util.concurrent.Executor;

/**
 * 异步任务执行器配置。
 * <p>
 * 为采集任务提供独立的线程池，避免阻塞 Web 请求线程。
 * 核心线程 2、最大 4、队列 10，拒绝策略：调用者线程执行。
 * </p>
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean("collectionTaskExecutor")
    public Executor collectionTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(10);
        executor.setThreadNamePrefix("collect-");
        executor.setRejectedExecutionHandler(new java.util.concurrent.ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}