package com.frontierscan.common.security;

/**
 * JWT Token 中解析出的当前认证用户主体。
 * <p>
 * 实现了 {@link org.springframework.security.core.Authentication#getPrincipal()} 的返回类型，
 * 可在 Controller 方法参数中使用 {@code @AuthenticationPrincipal JwtPrincipal principal} 获取当前用户信息。
 * </p>
 *
 * @param userId   用户数据库 ID
 * @param username 用户名
 * @param role     用户角色（ADMIN / USER）
 */
public record JwtPrincipal(Long userId, String username, String role) {
}