/**
 * 采集任务 API 服务。
 *
 * 提供与后端 /api/collection-runs 端点对应的操作：
 * 任务历史查询和手动触发采集。
 *
 * @module api/collectionRuns
 */
import { apiClient } from './client';
import type { ApiResponse, CollectionRun } from '@/types';

export const collectionRunApi = {
  /** 查询当前用户的采集任务历史记录 */
  list() {
    return apiClient.get<ApiResponse<CollectionRun[]>>('/collection-runs');
  },
  /** 手动触发对指定网站的采集 */
  trigger(siteId: number) {
    return apiClient.post<ApiResponse<CollectionRun>>(`/collection-runs/sites/${siteId}`);
  },
};