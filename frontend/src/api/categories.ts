import { apiClient } from './client';
import type { Category } from '@/types';

export const categoryApi = {
  list(includeArchived = false) {
    return apiClient.get<ApiResponse<Category[]>>('/categories', { params: { includeArchived } });
  },
  get(id: number) {
    return apiClient.get<ApiResponse<Category>>(`/categories/${id}`);
  },
  create(data: { name: string; description?: string; sortOrder?: number }) {
    return apiClient.post<ApiResponse<Category>>('/categories', data);
  },
  update(id: number, data: { name?: string; description?: string; sortOrder?: number; archived?: boolean }) {
    return apiClient.put<ApiResponse<Category>>(`/categories/${id}`, data);
  },
  delete(id: number) {
    return apiClient.delete<ApiResponse<{ message: string }>>(`/categories/${id}`);
  },
};
