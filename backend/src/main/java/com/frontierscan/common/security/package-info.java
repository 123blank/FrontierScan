/**
 * 安全认证基础设施，提供 JWT Token 的生成、解析和请求过滤能力。
 * <p>
 * {@link com.frontierscan.common.security.JwtUtil} 负责 Token 的完整生命周期管理，
 * {@link com.frontierscan.common.security.JwtAuthenticationFilter} 作为 Spring Security 过滤器链的一环。
 * </p>
 */
package com.frontierscan.common.security;