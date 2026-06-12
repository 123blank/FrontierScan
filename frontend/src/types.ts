/**
 * FrontierScan 前端类型定义。
 *
 * 定义了所有后端 API 响应的 TypeScript 接口，
 * 确保前端调用和后端数据模型保持一致的类型安全。
 *
 * @module types
 */

/** 统一 API 响应格式（与后端 ApiResponse.java 对应） */
export interface ApiResponse<T> {
  /** 请求是否成功 */
  success: boolean;
  /** 成功时的业务数据 */
  data: T;
  /** 响应消息 */
  message: string;
  /** 服务器时间戳 */
  timestamp: string;
}

/** 信息分类 */
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

/** 信息源网站 */
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

/** 采集文章 */
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

/** 采集任务记录 */
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

/** 收藏文章视图 */
export interface FavoriteArticle {
  favoriteId: number;
  articleId: number;
  title: string;
  summary: string | null;
  keyPoints: string | null;
  tags: string | null;
  sourceUrl: string;
  publishedAt: string | null;
  collectedAt: string;
  favoritedAt: string;
}

/** Spring Data 分页响应格式 */
/** ???????????????? */
export interface TagDomain {
  id: number;
  name: string;
  tags: TagItem[];
}

/** ??? */
export interface TagItem {
  id: number;
  name: string;
  description: string;
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
