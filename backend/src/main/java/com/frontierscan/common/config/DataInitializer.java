package com.frontierscan.common.config;

import com.frontierscan.auth.AuthService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/**
 * 应用启动数据初始化器。
 * <p>
 * 在应用启动后自动执行，初始化必要的默认数据。
 * 当前实现：在数据库中不存在管理员账号时，自动创建默认管理员 {@code admin/admin123}。
 * </p>
 *
 * @see AuthService#createAdminIfNotExists()
 */
@Component
public class DataInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    private final AuthService authService;

    public DataInitializer(AuthService authService) {
        this.authService = authService;
    }

    /**
     * 应用启动后执行数据初始化。
     *
     * @param args 命令行参数（未使用）
     */
    @Override
    public void run(String... args) {
        var admin = authService.createAdminIfNotExists();
        if (admin != null) {
            log.info("Initialized default admin user: admin");
        }
    }
}