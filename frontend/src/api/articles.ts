import { apiClient } from './client';
import type { Article, Page } from '@/types';

export const articleApi = {
  list(params: { categoryId?: number; siteId?: number; page?: number; size?: number }) {
    return apiClient.get<ApiResponse<Page<Article>>>('/articles', { params });
  },
  get(id: number) {
    return apiClient.get<ApiResponse<Article>>(`/articles/${id}`);
  },
  toggleFavorite(id: number) {
    return apiClient.post<ApiResponse<{ favorited: boolean }>>(`/articles/${id}/favorite`);
  },
  removeFavorite(id: number) {
    return apiClient.delete<ApiResponse<{ favorited: boolean }>>(`/articles/${id}/favorite`);
  },
  favorites() {
    return apiClient.get<ApiResponse<Array<{ id: number; articleId: number; createdAt: string }>>>('/articles/favorites');
  },
  count() {
    return apiClient.get<ApiResponse<{ total: number; today: number }>>('/articles/count');
  },
};
