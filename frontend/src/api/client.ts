/**
 * HTTP 客户端配置。
 *
 * 基于 Axios 创建预配置的 API 客户端实例，统一管理：
 * - API 基础路径（从环境变量 VITE_API_BASE_URL 读取，默认 /api）
 * - 请求超时时间（15 秒）
 * - 自动注入 JWT Token 到每个请求的 Authorization 头
 *
 * @module api/client
 */
import axios from 'axios';

/** 预配置的 Axios 实例，所有 API 调用均通过此实例发起 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 15000,
});

/**
 * 请求拦截器：自动从 localStorage 读取 JWT Token 并注入请求头。
 * 后端根据此 Token 识别当前用户身份并进行数据隔离。
 */
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('frontierscan_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});