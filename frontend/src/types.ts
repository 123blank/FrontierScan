export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
}

export interface Category {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Site {
  id: number;
  userId: number;
  categoryId: number;
  name: string;
  url: string;
  rssUrl: string | null;
  collectionIntervalMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Article {
  id: number;
  userId: number;
  siteId: number;
  categoryId: number;
  title: string;
  summary: string | null;
  keyPoints: string | null;
  tags: string | null;
  contentExcerpt: string | null;
  sourceUrl: string;
  sourceHash: string;
  publishedAt: string | null;
  collectedAt: string;
  createdAt: string;
}

export interface CollectionRun {
  id: number;
  userId: number;
  siteId: number | null;
  runType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  collectedCount: number;
  errorMessage: string | null;
}

export interface Page<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  first: boolean;
  last: boolean;
  empty: boolean;
}
