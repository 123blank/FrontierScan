package com.frontierscan.common.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * JWT Token 工具类，负责 Token 的生成、解析和校验。
 * <p>
 * 使用 HMAC-SHA256 算法签名，密钥从配置文件 {@code app.security.jwt-secret} 读取。
 * Token 中包含 userId、username 和 role 三个自定义声明。
 * 使用前需在 {@code application.yml} 中配置不少于 256 位的安全密钥。
 * </p>
 */
@Component
public class JwtUtil {

    private final SecretKey secretKey;
    private final long expiresInSeconds;

    /**
     * 构造 JwtUtil 实例。
     *
     * @param jwtSecret         JWT 签名密钥（至少 256 位，建议使用 64 字符以上随机字符串）
     * @param expiresInSeconds  Token 过期时间（秒）
     */
    public JwtUtil(
            @Value("${app.security.jwt-secret}") String jwtSecret,
            @Value("${app.security.jwt-expires-in-seconds}") long expiresInSeconds
    ) {
        this.secretKey = Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8));
        this.expiresInSeconds = expiresInSeconds;
    }

    /**
     * 生成 JWT Token。
     *
     * @param userId   用户 ID
     * @param username 用户名
     * @param role     用户角色
     * @return 签发的 JWT Token 字符串
     */
    public String generateToken(Long userId, String username, String role) {
        Date now = new Date();
        Date expiration = new Date(now.getTime() + expiresInSeconds * 1000);

        return Jwts.builder()
                .subject(username)
                .claim("userId", userId)
                .claim("role", role)
                .issuedAt(now)
                .expiration(expiration)
                .signWith(secretKey)
                .compact();
    }

    /**
     * 解析 JWT Token，返回所有声明。
     *
     * @param token JWT Token 字符串
     * @return Token 中的声明集合
     * @throws io.jsonwebtoken.JwtException 如果 Token 无效、过期或签名不匹配
     */
    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /**
     * 校验 Token 是否有效（签名正确且未过期）。
     *
     * @param token JWT Token 字符串
     * @return true 如果 Token 有效
     */
    public boolean isValidToken(String token) {
        try {
            parseToken(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 从 Token 中提取用户 ID。
     *
     * @param token JWT Token 字符串
     * @return 用户 ID
     */
    public Long getUserIdFromToken(String token) {
        return parseToken(token).get("userId", Long.class);
    }

    /**
     * 从 Token 中提取用户名。
     *
     * @param token JWT Token 字符串
     * @return 用户名
     */
    public String getUsernameFromToken(String token) {
        return parseToken(token).getSubject();
    }
}