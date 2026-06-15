/**
 * 文章 API 服务。
 *
 * 提供与后端 /api/articles 端点对应的所有操作：
 * 分页查询、详情获取、收藏切换、收藏列表和统计信息。
 *
 * @module api/articles
 */
import { apiClient } from './client';
import type { ApiResponse, Article, FavoriteArticle, Page } from '@/types';

export const articleApi = {
  /** 分页查询文章列表（支持按分类/来源网站筛选） */
  list(params: {
    categoryId?: number;
    siteId?: number;
    keyword?: string;
    tagId?: number;
    startDate?: string;
    endDate?: string;
    page?: number;
    size?: number;
  }) {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) clean[key] = value;
    }
    return apiClient.get<ApiResponse<Page<Article>>>('/articles', { params: clean });
  },
  /** 获取文章详情 */
  get(id: number) {
    return apiClient.get<ApiResponse<Article>>(`/articles/${id}`);
  },
  /** 重新生成文章摘要 */
  retrySummary(id: number) {
    return apiClient.post<ApiResponse<Article>>(`/articles/${id}/summary/retry`);
  },
  /** 切换收藏状态 */
  toggleFavorite(id: number) {
    return apiClient.post<ApiResponse<{ favorited: boolean }>>(`/articles/${id}/favorite`);
  },
  /** 取消收藏 */
  removeFavorite(id: number) {
    return apiClient.delete<ApiResponse<{ favorited: boolean }>>(`/articles/${id}/favorite`);
  },
  /** 获取收藏列表 */
  favorites(params?: {
    keyword?: string;
    tagId?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const clean: Record<string, any> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) clean[key] = value;
      }
    }
    return apiClient.get<ApiResponse<FavoriteArticle[]>>('/articles/favorites', { params: Object.keys(clean).length ? clean : undefined });
  },
  /** 获取文章统计（总量 + 今日采集数） */
  count() {
    return apiClient.get<ApiResponse<{ total: number; today: number }>>('/articles/count');
  },
};
