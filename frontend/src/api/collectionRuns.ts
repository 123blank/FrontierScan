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
  /** 获取单个采集任务的详细信息 */
  get(runId: number) {
    return apiClient.get<ApiResponse<CollectionRun>>(`/collection-runs/${runId}`);
  },
  /** 重试失败的采集任务 */
  retry(runId: number) {
    return apiClient.post<ApiResponse<{ message: string; runId: number }>>(`/collection-runs/${runId}/retry`);
  },
  /** 手动触发对指定网站的采集 */
  trigger(siteId: number) {
    return apiClient.post<ApiResponse<{ message: string; runId: number }>>(`/collection-runs/sites/${siteId}`);
  },
};
