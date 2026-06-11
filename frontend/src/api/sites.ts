/**
 * 网站管理 API 服务。
 *
 * 提供与后端 /api/sites 端点对应的所有操作：
 * 列表查询（可选按分类筛选）、详情获取、创建、更新和删除。
 *
 * @module api/sites
 */
import { apiClient } from './client';
import type { ApiResponse, Site } from '@/types';

export const siteApi = {
  /** 查询网站列表（可选按分类筛选） */
  list(categoryId?: number) {
    return apiClient.get<ApiResponse<Site[]>>('/sites', { params: { categoryId } });
  },
  /** 获取单个网站详情 */
  get(id: number) {
    return apiClient.get<ApiResponse<Site>>(`/sites/${id}`);
  },
  /** 创建新的信息源网站 */
  create(data: { name: string; url: string; categoryId: number; rssUrl?: string; collectionIntervalMinutes?: number; enabled?: boolean }) {
    return apiClient.post<ApiResponse<Site>>('/sites', data);
  },
  /** 更新网站配置（局部更新） */
  update(id: number, data: { name?: string; url?: string; categoryId?: number; rssUrl?: string; collectionIntervalMinutes?: number; enabled?: boolean }) {
    return apiClient.put<ApiResponse<Site>>(`/sites/${id}`, data);
  },
  /** 删除网站 */
  delete(id: number) {
    return apiClient.delete<ApiResponse<{ message: string }>>(`/sites/${id}`);
  },
};