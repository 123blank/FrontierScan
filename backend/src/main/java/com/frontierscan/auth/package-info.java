/**
 * 认证与用户管理模块，处理用户注册、登录、Token 发放和用户数据隔离。
 * <p>
 * 第一版采用基础账号权限模型（管理员/普通用户），不实现完整 RBAC。
 * 所有 API 通过 JWT Token 进行用户身份识别和数据隔离。
 * </p>
 */
package com.frontierscan.auth;