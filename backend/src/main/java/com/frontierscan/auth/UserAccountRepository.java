package com.frontierscan.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

/**
 * 用户账号数据访问接口。
 * <p>
 * 提供用户信息的基本 CRUD 操作，以及按用户名查询等认证所需方法。
 * </p>
 */
public interface UserAccountRepository extends JpaRepository<UserAccount, Long> {

    /**
     * 根据用户名查找用户账号。
     *
     * @param username 用户名（精确匹配）
     * @return 包含用户信息的 Optional
     */
    Optional<UserAccount> findByUsername(String username);

    /**
     * 检查用户名是否已被注册。
     *
     * @param username 用户名
     * @return true 如果用户名已存在
     */
    boolean existsByUsername(String username);
}