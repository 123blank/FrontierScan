package com.frontierscan;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * FrontierScan 后端应用程序入口。
 * <p>
 * FrontierScan 是一款企业级 Web Agent 系统，用于采集、整理和展示技术/AI 前沿网站信息。
 * 采用 Spring Boot 3 框架，JWT 认证，PostgreSQL 存储，Redis 缓存。
 * </p>
 *
 * @SpringBootApplication 启用自动配置和组件扫描
 * @ConfigurationPropertiesScan 自动扫描并注册 @ConfigurationProperties 组件
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
@MapperScan("com.frontierscan.llm.tag.mapper")
public class FrontierScanApplication {

    public static void main(String[] args) {
        SpringApplication.run(FrontierScanApplication.class, args);
    }
}
