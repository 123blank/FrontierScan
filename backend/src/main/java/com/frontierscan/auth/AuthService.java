package com.frontierscan.auth;

import com.frontierscan.common.security.JwtUtil;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;

/**
 * 认证与用户管理业务服务。
 * <p>
 * 处理用户登录验证、JWT Token 发放和默认管理员账号初始化。
 * 登录时校验用户名是否存在、密码是否匹配以及账号状态是否正常。
 * </p>
 */
@Service
public class AuthService {

    private final UserAccountRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    public AuthService(UserAccountRepository userRepository, PasswordEncoder passwordEncoder, JwtUtil jwtUtil) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
    }

    /** 登录结果记录，包含发放的 Token 和用户基本信息。 */
    public record LoginResult(String token, String username, String role) {}

    /**
     * 用户登录认证。
     * <p>
     * 验证流程：用户名是否存在 → 密码是否匹配 → 账号是否被禁用。
     * 全部通过后生成并返回 JWT Token。
     * </p>
     *
     * @param username 用户名
     * @param password 明文密码
     * @return 包含 Token、用户名和角色的登录结果
     * @throws RuntimeException 如果用户名或密码错误，或账号已被禁用
     */
    public LoginResult login(String username, String password) {
        UserAccount user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户名或密码错误"));

        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new RuntimeException("用户名或密码错误");
        }

        if (!"ACTIVE".equals(user.getStatus())) {
            throw new RuntimeException("账号已被禁用");
        }

        String token = jwtUtil.generateToken(user.getId(), user.getUsername(), user.getRole());
        return new LoginResult(token, user.getUsername(), user.getRole());
    }

    /**
     * 创建默认管理员账号（如果数据库中尚不存在）。
     * <p>
     * 在应用首次启动时由 {@link com.frontierscan.common.config.DataInitializer} 调用。
     * 默认管理员用户名 {@code admin}，密码 {@code admin123}。
     * </p>
     *
     * @return 创建的管理员用户，如果已存在则返回现有用户
     */
    public UserAccount createAdminIfNotExists() {
        if (!userRepository.existsByUsername("admin")) {
            UserAccount admin = new UserAccount();
            admin.setUsername("admin");
            admin.setPasswordHash(passwordEncoder.encode("admin123"));
            admin.setRole("ADMIN");
            admin.setStatus("ACTIVE");
            admin.setCreatedAt(OffsetDateTime.now());
            admin.setUpdatedAt(OffsetDateTime.now());
            return userRepository.save(admin);
        }
        return userRepository.findByUsername("admin").orElse(null);
    }
}