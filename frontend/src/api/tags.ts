/**
 * 标签管理 API 服务。
 *
 * 提供与后端 /api/tags 端点对应的操作：
 * 查询所有标签领域及其标签、查询指定领域的标签。
 *
 * @module api/tags
 */
import { apiClient } from './client';
import type { ApiResponse, TagDomain, TagItem } from '@/types';

export const tagApi = {
  /** 获取所有标签领域及其标签列表 */
  listDomains() {
    return apiClient.get<ApiResponse<TagDomain[]>>('/tags/domains');
  },
  /** 获取指定领域的所有标签 */
  listTagsByDomain(domainName: string) {
    return apiClient.get<ApiResponse<TagItem[]>>(`/tags/domains/${domainName}`);
  },
};
