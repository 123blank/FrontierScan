import { defineStore } from 'pinia';
import { apiClient } from '@/api/client';

interface LoginResponse {
  token: string;
  username: string;
  role: string;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('frontierscan_token') ?? '',
    username: localStorage.getItem('frontierscan_username') ?? '',
    role: localStorage.getItem('frontierscan_role') ?? '',
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token),
  },
  actions: {
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
