import { apiClient } from './client';
import type { Site } from '@/types';

export const siteApi = {
  list(categoryId?: number) {
    return apiClient.get<ApiResponse<Site[]>>('/sites', { params: { categoryId } });
  },
  get(id: number) {
    return apiClient.get<ApiResponse<Site>>(`/sites/${id}`);
  },
  create(data: { name: string; url: string; categoryId: number; rssUrl?: string; collectionIntervalMinutes?: number; enabled?: boolean }) {
    return apiClient.post<ApiResponse<Site>>('/sites', data);
  },
  update(id: number, data: { name?: string; url?: string; categoryId?: number; rssUrl?: string; collectionIntervalMinutes?: number; enabled?: boolean }) {
    return apiClient.put<ApiResponse<Site>>(`/sites/${id}`, data);
  },
  delete(id: number) {
    return apiClient.delete<ApiResponse<{ message: string }>>(`/sites/${id}`);
  },
};
