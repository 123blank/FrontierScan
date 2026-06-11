<!--
  DashboardView - 信息看板首页。

  展示系统核心统计指标（分类数、网站数、今日采集数）和最新文章列表。
  所有数据在页面挂载时通过 API 并行加载。
-->
<template>
  <!-- 核心统计指标卡片 -->
  <div class="dashboard-grid">
    <section class="metric-card">
      <span>分类</span>
      <strong>{{ stats.categories }}</strong>
      <small>信息分类</small>
    </section>
    <section class="metric-card">
      <span>网站</span>
      <strong>{{ stats.sites }}</strong>
      <small>RSS + 网页解析</small>
    </section>
    <section class="metric-card">
      <span>今日采集</span>
      <strong>{{ stats.today }}</strong>
      <small>累计 {{ stats.totalArticles }} 篇</small>
    </section>
  </div>

  <!-- 最新文章列表 -->
  <section class="section-block">
    <div class="section-heading">
      <h2>最新文章</h2>
      <div class="article-controls" aria-label="文章分页设置">
        <label>
          每页
          <select v-model.number="pageSize" :disabled="loading" @change="handlePageSizeChange">
            <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
          </select>
          条
        </label>
      </div>
    </div>
    <div v-if="loading" class="empty-state"><p>加载中...</p></div>
    <div v-else-if="articles.length === 0" class="empty-state">
      <strong>还没有采集内容</strong>
      <p>请先在「分类管理」和「网站管理」中添加信息源，然后触发采集。</p>
    </div>
    <div v-else class="article-list">
      <article
        v-for="article in articles"
        :key="article.id"
        class="article-card"
        tabindex="0"
        @click="openArticleDetail(article.id)"
        @keydown.enter="openArticleDetail(article.id)"
      >
        <div class="article-card-header">
          <h3>
            <span>{{ article.title }}</span><sup v-if="isNewArticle(article.collectedAt)" class="new-badge">new</sup>
          </h3>
          <button
            class="icon-button favorite-button"
            :class="{ active: favoriteArticleIds.has(article.id) }"
            :disabled="favoritePendingIds.has(article.id)"
            :aria-label="favoriteArticleIds.has(article.id) ? '取消收藏' : '收藏文章'"
            :title="favoriteArticleIds.has(article.id) ? '取消收藏' : '收藏文章'"
            @click.stop="toggleFavorite(article.id)"
          >
            ★
          </button>
        </div>
        <p class="article-meta">
          <span>发布时间 {{ formatDate(article.publishedAt) }}</span>
        </p>
        <div v-if="splitCsv(article.tags).length" class="tag-list article-card-tags" aria-label="文章标签">
          <span v-for="tag in splitCsv(article.tags)" :key="tag">{{ tag }}</span>
        </div>
        <p v-if="article.summary" class="article-summary">{{ article.summary }}</p>
        <a :href="article.sourceUrl" target="_blank" rel="noopener" @click.stop>查看原文</a>
      </article>
    </div>

    <div v-if="totalElements > 0" class="pagination-bar" aria-label="最新文章分页">
      <span>共 {{ totalElements }} 篇，第 {{ currentPage + 1 }} / {{ totalPages || 1 }} 页</span>
      <div class="pagination-actions">
        <button :disabled="loading || currentPage === 0" @click="goToPage(0)">首页</button>
        <button :disabled="loading || currentPage === 0" @click="goToPage(currentPage - 1)">上一页</button>
        <button :disabled="loading || currentPage >= totalPages - 1" @click="goToPage(currentPage + 1)">下一页</button>
        <button :disabled="loading || currentPage >= totalPages - 1" @click="goToPage(totalPages - 1)">末页</button>
      </div>
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
            class="icon-button favorite-button"
            :class="{ active: favoriteArticleIds.has(selectedArticle.id) }"
            :disabled="favoritePendingIds.has(selectedArticle.id)"
            :aria-label="favoriteArticleIds.has(selectedArticle.id) ? '取消收藏' : '收藏文章'"
            :title="favoriteArticleIds.has(selectedArticle.id) ? '取消收藏' : '收藏文章'"
            @click="toggleFavorite(selectedArticle.id)"
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
import { computed, ref, onMounted } from 'vue';
import { articleApi } from '@/api/articles';
import { categoryApi } from '@/api/categories';
import { siteApi } from '@/api/sites';
import type { Article } from '@/types';

/** 仪表盘统计信息 */
const stats = ref({ categories: 0, sites: 0, today: 0, totalArticles: 0 });
/** 最新文章列表 */
const articles = ref<Article[]>([]);
/** 数据加载状态 */
const loading = ref(true);
/** 当前分页页码，后端 Spring Data 从 0 开始计数 */
const currentPage = ref(0);
/** 每页文章数量，默认按需求展示 10 条 */
const pageSize = ref(10);
/** 用户可选分页大小 */
const pageSizeOptions = [10, 20, 50];
/** 新文章标识展示窗口，当前产品约定为采集后 12 小时内显示。 */
const newArticleWindowMs = 12 * 60 * 60 * 1000;
/** 最新文章总数 */
const totalElements = ref(0);
/** 最新文章总页数 */
const totalPages = ref(0);
/** 当前用户已收藏的文章 ID 集合，用于列表和详情同步展示收藏状态 */
const favoriteArticleIds = ref<Set<number>>(new Set());
/** 正在提交收藏状态变更的文章 ID 集合，防止用户连续点击造成前后端状态错乱 */
const favoritePendingIds = ref<Set<number>>(new Set());
/** 详情抽屉是否打开 */
const detailOpen = ref(false);
/** 详情抽屉加载状态 */
const detailLoading = ref(false);
/** 详情抽屉错误信息 */
const detailError = ref('');
/** 当前详情文章 */
const selectedArticle = ref<Article | null>(null);

/** 当前文章关键要点列表 */
const keyPoints = computed(() => splitMultiline(selectedArticle.value?.keyPoints));
/** 当前文章标签列表 */
const tagList = computed(() => splitCsv(selectedArticle.value?.tags));

/** 页面挂载时并行加载所有统计数据 */
onMounted(async () => {
  await loadDashboard();
});

/** 加载看板统计、收藏状态和当前页文章。 */
async function loadDashboard() {
  loading.value = true;
  try {
    const [catRes, siteRes, countRes, favoriteRes] = await Promise.all([
      categoryApi.list(),
      siteApi.list(),
      articleApi.count(),
      articleApi.favorites(),
    ]);
    stats.value.categories = catRes.data.data.length;
    stats.value.sites = siteRes.data.data.length;
    stats.value.today = countRes.data.data.today;
    stats.value.totalArticles = countRes.data.data.total;
    favoriteArticleIds.value = new Set(favoriteRes.data.data.map((favorite) => favorite.articleId));
    await loadArticles();
  } catch {
    // 后端未启动时静默降级，保持 UI 可用状态
  } finally {
    loading.value = false;
  }
}

/** 按当前分页参数加载最新文章。 */
async function loadArticles() {
  const articleRes = await articleApi.list({ page: currentPage.value, size: pageSize.value });
  const page = articleRes.data.data;
  articles.value = page.content;
  totalElements.value = page.totalElements;
  totalPages.value = page.totalPages;
  currentPage.value = page.number;
  pageSize.value = page.size;
}

/** 切换分页大小时回到第一页并重新加载。 */
async function handlePageSizeChange() {
  currentPage.value = 0;
  await reloadArticlePage();
}

/** 跳转到指定页。 */
async function goToPage(page: number) {
  if (page < 0 || (totalPages.value > 0 && page >= totalPages.value)) {
    return;
  }
  currentPage.value = page;
  await reloadArticlePage();
}

/** 只刷新文章分页区域，避免重复请求统计数据。 */
async function reloadArticlePage() {
  loading.value = true;
  try {
    await loadArticles();
  } finally {
    loading.value = false;
  }
}

/** 打开文章详情抽屉并加载最新详情数据。 */
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

/** 关闭文章详情抽屉并清理临时状态。 */
function closeArticleDetail() {
  detailOpen.value = false;
  detailError.value = '';
  selectedArticle.value = null;
}

/** 收藏或取消收藏文章，并同步列表/详情中的收藏状态。 */
async function toggleFavorite(articleId: number) {
  if (favoritePendingIds.value.has(articleId)) {
    return;
  }

  const wasFavorite = favoriteArticleIds.value.has(articleId);
  const next = new Set(favoriteArticleIds.value);
  const pending = new Set(favoritePendingIds.value);
  pending.add(articleId);
  favoritePendingIds.value = pending;

  if (wasFavorite) {
    next.delete(articleId);
  } else {
    next.add(articleId);
  }
  favoriteArticleIds.value = next;

  try {
    if (wasFavorite) {
      await articleApi.removeFavorite(articleId);
    } else {
      await articleApi.toggleFavorite(articleId);
    }
  } catch {
    favoriteArticleIds.value = new Set(wasFavorite ? [...next, articleId] : [...next].filter((id) => id !== articleId));
  } finally {
    const latestPending = new Set(favoritePendingIds.value);
    latestPending.delete(articleId);
    favoritePendingIds.value = latestPending;
  }
}

/** 将后端换行文本转换为列表，兼容空值。 */
function splitMultiline(value?: string | null) {
  return (value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 将逗号分隔标签转换为列表，兼容中文逗号。 */
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

/** 格式化日期时间，空值显示占位。 */
function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}
</script>

<style scoped>
.article-controls { align-items: center; display: flex; gap: 12px; }
.article-controls label { align-items: center; color: #53605c; display: flex; gap: 8px; font-size: 14px; }
.article-controls select {
  border: 1px solid #d7dfdc;
  border-radius: 6px;
  color: #17202a;
  padding: 8px 10px;
}
.article-list { display: grid; gap: 12px; }
.article-card {
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
.article-card h3 { font-size: 16px; margin: 0 0 6px; }
.new-badge {
  color: #d93025;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  margin-left: 4px;
  text-transform: lowercase;
  vertical-align: super;
}
.article-meta { color: #67726f; font-size: 13px; margin: 0 0 8px; }
.article-meta span + span::before { content: "·"; margin: 0 6px; }
.article-card-tags { margin: 0 0 10px; }
.article-summary { color: #3e4c48; font-size: 14px; line-height: 1.6; margin: 0 0 8px; }
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
.pagination-bar {
  align-items: center;
  border-top: 1px solid #e3e9e6;
  color: #53605c;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  margin-top: 16px;
  padding-top: 16px;
}
.pagination-actions { display: flex; gap: 8px; }
.pagination-actions button, .secondary-button {
  background: #eef4f2;
  color: #136f63;
}
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
  gap: 0;
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
  .section-heading, .pagination-bar, .drawer-actions { align-items: stretch; flex-direction: column; }
  .pagination-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .detail-meta { grid-template-columns: 1fr; }
  .detail-meta div + div { border-left: 0; border-top: 1px solid #e3e9e6; }
}
</style>
