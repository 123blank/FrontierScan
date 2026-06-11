<!--
  SitesView - 网站管理页面。

  提供信息源网站的创建、启停、手动触发采集和删除操作。
  网站配置包含名称、URL、RSS 地址、采集频率等信息。
-->
<template>
  <section class="section-block">
    <div class="section-heading">
      <h2>网站管理</h2>
      <button type="button" @click="showForm = true">新增网站</button>
    </div>

    <!-- 新增网站内联表单 -->
    <div v-if="showForm" class="inline-form">
      <input v-model="form.name" placeholder="网站名称" />
      <input v-model="form.url" placeholder="网站地址" />
      <select v-model.number="form.categoryId">
        <option :value="0" disabled>选择分类</option>
        <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
      </select>
      <input v-model="form.rssUrl" placeholder="RSS 地址（可选）" />
      <input v-model.number="form.collectionIntervalMinutes" type="number" placeholder="采集间隔（分钟）" />
      <button type="button" @click="createSite" :disabled="!form.name || !form.url || !form.categoryId">保存</button>
      <button type="button" class="btn-secondary" @click="cancelForm">取消</button>
    </div>

    <!-- 网站列表 -->
    <div v-if="loading" class="empty-state"><p>加载中...</p></div>
    <div v-else-if="sites.length === 0" class="empty-state">
      <strong>还没有网站</strong>
      <p>添加网站来配置信息源。</p>
    </div>
    <table v-else class="data-table">
      <thead>
        <tr><th>网站</th><th>分类</th><th>RSS</th><th>采集频率</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="site in sites" :key="site.id">
          <td><a :href="site.url" target="_blank" rel="noopener">{{ site.name }}</a></td>
          <td>{{ categoryName(site.categoryId) }}</td>
          <td>{{ site.rssUrl ? '✓' : '-' }}</td>
          <td>{{ site.collectionIntervalMinutes }}分钟</td>
          <td>{{ site.enabled ? '启用' : '停用' }}</td>
          <td>
            <button type="button" class="btn-sm" @click="toggleSite(site)">{{ site.enabled ? '停用' : '启用' }}</button>
            <button type="button" class="btn-sm" @click="triggerCollect(site.id)">采集</button>
            <button type="button" class="btn-sm btn-danger" @click="deleteSite(site.id)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { siteApi } from '@/api/sites';
import { categoryApi } from '@/api/categories';
import { collectionRunApi } from '@/api/collectionRuns';
import type { Site, Category } from '@/types';

const sites = ref<Site[]>([]);
const categories = ref<Category[]>([]);
const loading = ref(true);
const showForm = ref(false);
const form = ref({ name: '', url: '', categoryId: 0, rssUrl: '', collectionIntervalMinutes: 1440 });

/** 并行加载网站列表和分类列表 */
async function load() {
  loading.value = true;
  try {
    const [siteRes, catRes] = await Promise.all([siteApi.list(), categoryApi.list()]);
    sites.value = siteRes.data.data;
    categories.value = catRes.data.data;
  } catch { /* 后端不可用时不展示错误 */ }
  loading.value = false;
}

/** 根据分类 ID 获取分类名称 */
function categoryName(id: number) {
  return categories.value.find(c => c.id === id)?.name || '-';
}

/** 创建新网站 */
async function createSite() {
  await siteApi.create({
    name: form.value.name, url: form.value.url, categoryId: form.value.categoryId,
    rssUrl: form.value.rssUrl || undefined, collectionIntervalMinutes: form.value.collectionIntervalMinutes,
  });
  form.value = { name: '', url: '', categoryId: 0, rssUrl: '', collectionIntervalMinutes: 1440 };
  showForm.value = false;
  await load();
}

function cancelForm() {
  form.value = { name: '', url: '', categoryId: 0, rssUrl: '', collectionIntervalMinutes: 1440 };
  showForm.value = false;
}

/** 切换网站的启用/停用状态 */
async function toggleSite(site: Site) {
  await siteApi.update(site.id, { enabled: !site.enabled });
  await load();
}

/** 触发手动采集 */
async function triggerCollect(siteId: number) {
  await collectionRunApi.trigger(siteId);
}

/** 删除网站 */
async function deleteSite(id: number) {
  if (!confirm('确定删除此网站？')) return;
  await siteApi.delete(id);
  await load();
}

onMounted(load);
</script>

<style scoped>
.inline-form { background: #f8faf9; border: 1px solid #e3e9e6; border-radius: 8px; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; padding: 12px; }
.inline-form input, .inline-form select { flex: 1; min-width: 120px; }
.data-table { border-collapse: collapse; width: 100%; }
.data-table th, .data-table td { border-bottom: 1px solid #e3e9e6; padding: 12px 8px; text-align: left; }
.data-table th { color: #5e6b67; font-size: 13px; font-weight: 600; }
.data-table a { color: #136f63; text-decoration: none; }
.data-table a:hover { text-decoration: underline; }
.btn-sm { font-size: 13px; margin-right: 6px; padding: 6px 10px; }
.btn-secondary { background: #e3e9e6; color: #17202a; }
.btn-danger { background: #a5362f; }
</style>