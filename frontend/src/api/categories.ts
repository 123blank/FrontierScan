/**
 * 分类管理 API 服务。
 *
 * 提供与后端 /api/categories 端点对应的所有操作：
 * 列表查询、详情获取、创建、更新和删除。
 *
 * @module api/categories
 */
import { apiClient } from './client';
import type { ApiResponse, Category } from '@/types';

export const categoryApi = {
  /** 查询分类列表 */
  list(includeArchived = false) {
    return apiClient.get<ApiResponse<Category[]>>('/categories', { params: { includeArchived } });
  },
  /** 获取单个分类详情 */
  get(id: number) {
    return apiClient.get<ApiResponse<Category>>(`/categories/${id}`);
  },
  /** 创建新分类 */
  create(data: { name: string; description?: string; sortOrder?: number }) {
    return apiClient.post<ApiResponse<Category>>('/categories', data);
  },
  /** 更新分类信息（局部更新） */
  update(id: number, data: { name?: string; description?: string; sortOrder?: number; archived?: boolean }) {
    return apiClient.put<ApiResponse<Category>>(`/categories/${id}`, data);
  },
  /** 删除分类 */
  delete(id: number) {
    return apiClient.delete<ApiResponse<{ message: string }>>(`/categories/${id}`);
  },
};