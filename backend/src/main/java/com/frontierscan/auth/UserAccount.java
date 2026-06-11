package com.frontierscan.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

/**
 * 用户账号实体，映射数据库 {@code app_users} 表。
 * <p>
 * 存储用户的登录凭证、角色和状态信息。密码以 BCrypt 哈希形式存储。
 * 第一版采用基础角色模型（ADMIN / USER），不实现完整 RBAC 权限体系。
 * </p>
 */
@Entity
@Table(name = "app_users")
public class UserAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 登录用户名（唯一） */
    @Column(nullable = false, unique = true, length = 100)
    private String username;

    /** BCrypt 加密后的密码哈希 */
    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    /** 用户角色：ADMIN（管理员）/ USER（普通用户） */
    @Column(nullable = false, length = 40)
    private String role;

    /** 账号状态：ACTIVE（正常）/ DISABLED（禁用） */
    @Column(nullable = false, length = 40)
    private String status;

    /** 创建时间 */
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    /** 最后更新时间 */
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}