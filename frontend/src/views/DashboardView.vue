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
    </div>
    <div v-if="loading" class="empty-state"><p>加载中...</p></div>
    <div v-else-if="articles.length === 0" class="empty-state">
      <strong>还没有采集内容</strong>
      <p>请先在「分类管理」和「网站管理」中添加信息源，然后触发采集。</p>
    </div>
    <div v-else class="article-list">
      <div v-for="article in articles" :key="article.id" class="article-card">
        <h3>{{ article.title }}</h3>
        <p class="article-meta">
          <span v-if="article.tags">{{ article.tags }}</span>
          <span>{{ new Date(article.collectedAt).toLocaleDateString('zh-CN') }}</span>
        </p>
        <p v-if="article.summary" class="article-summary">{{ article.summary }}</p>
        <a :href="article.sourceUrl" target="_blank" rel="noopener">查看原文</a>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
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

/** 页面挂载时并行加载所有统计数据 */
onMounted(async () => {
  try {
    const [catRes, siteRes, countRes, articleRes] = await Promise.all([
      categoryApi.list(),
      siteApi.list(),
      articleApi.count(),
      articleApi.list({ size: 10 }),
    ]);
    stats.value.categories = catRes.data.data.length;
    stats.value.sites = siteRes.data.data.length;
    stats.value.today = countRes.data.data.today;
    stats.value.totalArticles = countRes.data.data.total;
    articles.value = articleRes.data.data.content;
  } catch {
    // 后端未启动时静默降级，保持 UI 可用状态
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.article-list { display: grid; gap: 12px; }
.article-card { border: 1px solid #e3e9e6; border-radius: 8px; padding: 16px; }
.article-card h3 { font-size: 16px; margin: 0 0 6px; }
.article-meta { color: #67726f; font-size: 13px; margin: 0 0 8px; }
.article-meta span + span::before { content: "·"; margin: 0 6px; }
.article-summary { color: #3e4c48; font-size: 14px; line-height: 1.6; margin: 0 0 8px; }
.article-card a { color: #136f63; font-size: 13px; text-decoration: none; }
.article-card a:hover { text-decoration: underline; }
</style>