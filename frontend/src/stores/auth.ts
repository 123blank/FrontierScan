/**
 * 认证状态管理（Pinia Store）。
 *
 * 管理用户登录状态、JWT Token 持久化（localStorage）和登出操作。
 * Token 持久化后，即使刷新页面也能保持登录状态。
 *
 * @module stores/auth
 */
import { defineStore } from 'pinia';
import { apiClient } from '@/api/client';

/** 登录响应中包含的用户信息 */
interface LoginResponse {
  token: string;
  username: string;
  role: string;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    /** JWT Token，从 localStorage 恢复 */
    token: localStorage.getItem('frontierscan_token') ?? '',
    /** 当前用户名 */
    username: localStorage.getItem('frontierscan_username') ?? '',
    /** 当前用户角色 */
    role: localStorage.getItem('frontierscan_role') ?? '',
  }),
  getters: {
    /** 是否已登录（Token 非空即为已登录状态） */
    isAuthenticated: (state) => Boolean(state.token),
  },
  actions: {
    /**
     * 登录：调用后端认证接口，成功后持久化 Token 和用户信息。
     *
     * @param username 用户名
     * @param password 密码
     */
    async login(username: string, password: string) {
      const response = await apiClient.post<{ data: LoginResponse }>('/auth/login', { username, password });
      const payload = response.data.data;
      this.token = payload.token;
      this.username = payload.username;
      this.role = payload.role;
      localStorage.setItem('frontierscan_token', payload.token);
      localStorage.setItem('frontierscan_username', payload.username);
      localStorage.setItem('frontierscan_role', payload.role);
    },
    /** 登出：清除内存中的状态和 localStorage 中的持久化数据 */
    logout() {
      this.token = '';
      this.username = '';
      this.role = '';
      localStorage.removeItem('frontierscan_token');
      localStorage.removeItem('frontierscan_username');
      localStorage.removeItem('frontierscan_role');
    },
  },
});