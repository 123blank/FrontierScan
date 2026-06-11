import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('frontierscan_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
