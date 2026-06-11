import { apiClient } from './client';
import type { CollectionRun } from '@/types';

export const collectionRunApi = {
  list() {
    return apiClient.get<ApiResponse<CollectionRun[]>>('/collection-runs');
  },
  trigger(siteId: number) {
    return apiClient.post<ApiResponse<CollectionRun>>(`/collection-runs/sites/${siteId}`);
  },
};
