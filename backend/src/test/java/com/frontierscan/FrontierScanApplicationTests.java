package com.frontierscan;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * 应用启动上下文测试。
 * <p>
 * 验证 Spring 应用上下文能够正确加载，所有 Bean 依赖注入正常。
 * 使用 {@code test} Profile，采用 H2 嵌入式数据库替代 PostgreSQL，
 * 排除 Redis 和 Jackson 端点自动配置以适配测试环境。
 * </p>
 */
@SpringBootTest
@ActiveProfiles("test")
class FrontierScanApplicationTests {

    /**
     * 验证应用上下文能够成功启动。
     * 若此测试失败，说明配置或 Bean 注入存在问题。
     */
    @Test
    void contextLoads() {
    }
}