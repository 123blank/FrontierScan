<!--
  FavoritesView - 我的收藏页面。

  展示当前用户收藏过的文章，并提供继续阅读、打开原文和取消收藏能力。
  页面直接消费后端收藏文章视图，避免对每条收藏逐个请求详情。
-->
<template>
  <section class="section-block">
    <div class="section-heading">
      <h2>收藏文章</h2>
      <button type="button" :disabled="loading" @click="loadFavorites">刷新</button>
    </div>
    <ArticleFilterBar @filter-change="onFilterChange" />

    <div v-if="loading" class="empty-state"><p>加载中...</p></div>
    <div v-else-if="favorites.length === 0" class="empty-state">
      <strong>还没有收藏文章</strong>
      <p>在信息看板或文章详情中点击收藏后，可在这里继续阅读。</p>
    </div>
    <div v-else class="article-list">
      <article
        v-for="item in favorites"
        :key="item.favoriteId"
        class="article-card"
        tabindex="0"
        @click="openArticleDetail(item.articleId)"
        @keydown.enter="openArticleDetail(item.articleId)"
      >
        <div class="article-card-header">
          <h3>
            <span>{{ item.title }}</span><sup v-if="isNewArticle(item.collectedAt)" class="new-badge">new</sup>
          </h3>
          <button
            type="button"
            class="icon-button favorite-button active"
            :disabled="favoritePendingIds.has(item.articleId)"
            aria-label="取消收藏"
            title="取消收藏"
            @click.stop="removeFavorite(item.articleId)"
          >
            ★
          </button>
        </div>
        <p class="article-meta">
          <span>收藏于 {{ formatDateTime(item.favoritedAt) }}</span>
          <span>发布时间 {{ formatDate(item.publishedAt) }}</span>
        </p>
        <div v-if="splitCsv(item.tags).length" class="tag-list article-card-tags" aria-label="文章标签">
          <span v-for="tag in splitCsv(item.tags)" :key="tag">{{ tag }}</span>
        </div>
        <p v-if="item.summary" class="article-summary">{{ item.summary }}</p>
        <a :href="item.sourceUrl" target="_blank" rel="noopener" @click.stop>查看原文</a>
      </article>
    </div>
  </section>

  <div v-if="detailOpen" class="drawer-overlay" @click.self="closeArticleDetail">
    <aside class="article-drawer" aria-label="文章详情">
      <div class="drawer-header">
        <div>
          <span class="drawer-eyebrow">文章详情</span>
          <h2>{{ selectedArticle?.title || '加载中...' }}</h2>
        </div>
        <button class="icon-button close-button" aria-label="关闭详情" title="关闭详情" @click="closeArticleDetail">×</button>
      </div>

      <div v-if="detailLoading" class="empty-state"><p>加载中...</p></div>
      <div v-else-if="detailError" class="empty-state">
        <strong>文章加载失败</strong>
        <p>{{ detailError }}</p>
      </div>
      <div v-else-if="selectedArticle" class="drawer-content">
        <div class="drawer-actions">
          <button
            class="icon-button favorite-button active"
            :disabled="favoritePendingIds.has(selectedArticle.id)"
            aria-label="取消收藏"
            title="取消收藏"
            @click="removeFavorite(selectedArticle.id)"
          >
            ★
          </button>
          <a class="primary-link" :href="selectedArticle.sourceUrl" target="_blank" rel="noopener">打开原文</a>
        </div>

        <dl class="detail-meta">
          <div>
            <dt>发布时间</dt>
            <dd>{{ formatDateTime(selectedArticle.publishedAt) }}</dd>
          </div>
          <div>
            <dt>采集时间</dt>
            <dd>{{ formatDateTime(selectedArticle.collectedAt) }}</dd>
          </div>
        </dl>

        <section v-if="selectedArticle.summary" class="detail-section summary-section">
          <h3>简要总结</h3>
          <p>{{ selectedArticle.summary }}</p>
        </section>

        <section v-if="keyPoints.length" class="detail-section">
          <h3>关键要点</h3>
          <ul>
            <li v-for="point in keyPoints" :key="point">{{ point }}</li>
          </ul>
        </section>

        <section v-if="tagList.length" class="detail-section">
          <h3>标签</h3>
          <div class="tag-list">
            <span v-for="tag in tagList" :key="tag">{{ tag }}</span>
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { articleApi } from '@/api/articles';
import ArticleFilterBar from '@/components/ArticleFilterBar.vue';
import type { Article, FavoriteArticle } from '@/types';

/** 收藏文章列表。 */
const favorites = ref<FavoriteArticle[]>([]);
/** 正在取消收藏的文章 ID 集合，防止重复点击产生多次删除请求。 */
const favoritePendingIds = ref<Set<number>>(new Set());
/** 页面加载状态。 */
const loading = ref(true);
/** 详情抽屉是否打开。 */
const detailOpen = ref(false);
/** 详情加载状态。 */
const detailLoading = ref(false);
/** 详情错误信息。 */
const detailError = ref('');
/** 当前详情文章。 */
const selectedArticle = ref<Article | null>(null);

/** 当前详情文章关键要点。 */
const keyPoints = computed(() => splitMultiline(selectedArticle.value?.keyPoints));
/** 当前详情文章标签。 */
const tagList = computed(() => splitCsv(selectedArticle.value?.tags));
/** 新文章标识展示窗口，当前产品约定为采集后 12 小时内显示。 */
const newArticleWindowMs = 12 * 60 * 60 * 1000;
/** ???? */
const filterKeyword = ref('');
const filterTagId = ref<number | undefined>(undefined);
const filterStartDate = ref('');
const filterEndDate = ref('');

onMounted(loadFavorites);

/** 加载当前用户的收藏文章列表。 */
/** ????????????? */
function onFilterChange(filters: { keyword?: string; tagId?: number; startDate?: string; endDate?: string }) {
  filterKeyword.value = filters.keyword ?? '';
  filterTagId.value = filters.tagId;
  filterStartDate.value = filters.startDate ?? '';
  filterEndDate.value = filters.endDate ?? '';
  loadFavorites();
}

async function loadFavorites() {
  loading.value = true;
  try {
    const params: Record<string, any> = {};
    if (filterKeyword.value) params.keyword = filterKeyword.value;
    if (filterTagId.value) params.tagId = filterTagId.value;
    if (filterStartDate.value) params.startDate = filterStartDate.value;
    if (filterEndDate.value) params.endDate = filterEndDate.value;
    const res = await articleApi.favorites(Object.keys(params).length ? params as any : undefined);
    favorites.value = res.data.data;
  } finally {
    loading.value = false;
  }
}

/** 打开详情抽屉。 */
async function openArticleDetail(articleId: number) {
  detailOpen.value = true;
  detailLoading.value = true;
  detailError.value = '';
  selectedArticle.value = null;
  try {
    const res = await articleApi.get(articleId);
    selectedArticle.value = res.data.data;
  } catch {
    detailError.value = '请稍后重试，或刷新页面后再次打开。';
  } finally {
    detailLoading.value = false;
  }
}

/** 关闭详情抽屉。 */
function closeArticleDetail() {
  detailOpen.value = false;
  detailError.value = '';
  selectedArticle.value = null;
}

/** 取消收藏并从当前列表移除。 */
async function removeFavorite(articleId: number) {
  if (favoritePendingIds.value.has(articleId)) {
    return;
  }

  const pending = new Set(favoritePendingIds.value);
  pending.add(articleId);
  favoritePendingIds.value = pending;

  try {
    await articleApi.removeFavorite(articleId);
    favorites.value = favorites.value.filter((item) => item.articleId !== articleId);
    if (selectedArticle.value?.id === articleId) {
      closeArticleDetail();
    }
  } finally {
    const latestPending = new Set(favoritePendingIds.value);
    latestPending.delete(articleId);
    favoritePendingIds.value = latestPending;
  }
}

/** 将换行文本转换为列表。 */
function splitMultiline(value?: string | null) {
  return (value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 将逗号分隔标签转换为列表。 */
function splitCsv(value?: string | null) {
  return (value || '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 判断文章是否为 12 小时内采集的新消息，用于卡片标题旁展示 new 标识。 */
function isNewArticle(collectedAt?: string | null) {
  if (!collectedAt) {
    return false;
  }
  const collectedTime = new Date(collectedAt).getTime();
  if (Number.isNaN(collectedTime)) {
    return false;
  }
  const diff = Date.now() - collectedTime;
  return diff >= 0 && diff <= newArticleWindowMs;
}

/** 格式化原文发布时间，仅用于文章卡片日期展示，空值按产品约定显示占位。 */
function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '-';
}

/** 格式化日期时间。 */
function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}
</script>

<style scoped>
.article-list { display: grid; gap: 12px; }
.article-card {
  background: #fff;
  border: 1px solid #e3e9e6;
  border-radius: 8px;
  cursor: pointer;
  padding: 16px;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.article-card:focus, .article-card:hover {
  border-color: #9fc7bf;
  box-shadow: 0 8px 20px rgba(23, 32, 42, 0.08);
  outline: none;
}
.article-card-header { align-items: start; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) 34px; }
.article-card h3 {
  font-size: 16px;
  line-height: 1.45;
  margin: 0 0 6px;
  overflow-wrap: anywhere;
}
.new-badge {
  color: #d93025;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  margin-left: 4px;
  text-transform: lowercase;
  vertical-align: super;
}
.article-meta {
  color: #67726f;
  display: flex;
  flex-wrap: wrap;
  font-size: 13px;
  gap: 4px 10px;
  margin: 0 0 8px;
}
.article-meta span + span::before { content: "·"; margin: 0 6px; }
.article-card-tags { margin: 0 0 10px; }
.article-summary { color: #3e4c48; font-size: 14px; line-height: 1.6; margin: 0 0 10px; }
.article-card a { color: #136f63; font-size: 13px; text-decoration: none; }
.article-card a:hover { text-decoration: underline; }
.icon-button {
  align-items: center;
  background: #eef4f2;
  border-radius: 6px;
  color: #53605c;
  display: inline-flex;
  height: 34px;
  justify-content: center;
  padding: 0;
  width: 34px;
}
.icon-button:disabled {
  cursor: wait;
  opacity: 0.7;
}
.icon-button.active, .favorite-button.active { background: #fff5da; color: #8a5d00; }
.drawer-overlay {
  background: rgba(16, 35, 31, 0.42);
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 20;
}
.article-drawer {
  background: #fff;
  box-shadow: -16px 0 32px rgba(23, 32, 42, 0.18);
  display: flex;
  flex-direction: column;
  max-width: 720px;
  overflow-y: auto;
  padding: 24px;
  width: min(720px, 100%);
}
.drawer-header {
  align-items: start;
  border-bottom: 1px solid #e3e9e6;
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr) 34px;
  padding-bottom: 18px;
}
.drawer-header h2 { font-size: 22px; line-height: 1.35; margin: 4px 0 0; }
.drawer-eyebrow { color: #136f63; font-size: 13px; font-weight: 700; }
.close-button { font-size: 24px; line-height: 1; }
.drawer-content { display: grid; gap: 20px; padding-top: 18px; }
.drawer-actions { align-items: center; display: flex; gap: 12px; justify-content: space-between; }
.primary-link {
  background: #136f63;
  border-radius: 6px;
  color: #fff;
  padding: 10px 14px;
  text-decoration: none;
}
.detail-meta {
  border: 1px solid #e3e9e6;
  border-radius: 8px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}
.detail-meta div { padding: 14px; }
.detail-meta div + div { border-left: 1px solid #e3e9e6; }
.detail-meta dt { color: #67726f; font-size: 13px; margin-bottom: 6px; }
.detail-meta dd { color: #17202a; margin: 0; }
.detail-section h3 { font-size: 16px; margin: 0 0 10px; }
.detail-section p, .detail-section li { color: #3e4c48; line-height: 1.75; }
.detail-section ul { margin: 0; padding-left: 20px; }
.summary-section {
  background: #f8faf9;
  border: 1px solid #e3e9e6;
  border-radius: 8px;
  padding: 16px;
}
.summary-section p { margin: 0; }
.tag-list { display: flex; flex-wrap: wrap; gap: 8px; }
.tag-list span {
  background: #eef4f2;
  border-radius: 6px;
  color: #136f63;
  font-size: 13px;
  padding: 6px 10px;
}
@media (max-width: 720px) {
  .article-card {
    padding: 14px;
  }
  .detail-meta { grid-template-columns: 1fr; }
  .drawer-actions { align-items: stretch; flex-direction: column; }
  .detail-meta div + div { border-left: 0; border-top: 1px solid #e3e9e6; }
  .article-drawer {
    max-width: none;
    padding: 18px;
    width: 100%;
  }
}
</style>
