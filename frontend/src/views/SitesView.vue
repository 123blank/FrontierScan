<!--
  SitesView - 网站管理页面。

  提供信息源网站的创建、详情/编辑、启停、手动触发采集和删除操作。
  网站配置包含名称、URL、RSS 地址、采集频率等信息。
  所有操作通过 Toast 提示成功/失败结果。
-->
<template>
  <section class="section-block">
    <div class="section-heading">
      <h2>网站管理</h2>
      <button type="button" @click="openCreateDialog">新增网站</button>
    </div>

    <div v-if="loading" class="empty-state"><p>加载中...</p></div>
    <div v-else-if="sites.length === 0" class="empty-state">
      <strong>还没有网站</strong>
      <p>添加网站来配置信息源。</p>
    </div>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>网站</th><th>分类</th><th>RSS</th><th>采集频率</th><th>连续失败</th>
          <th>最后成功</th><th>最后失败</th><th>下次重试</th><th>状态</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="site in sites" :key="site.id">
          <td>
            <a :href="site.url" target="_blank" rel="noopener">{{ site.name }}</a>
          </td>
          <td>{{ categoryName(site.categoryId) }}</td>
          <td>{{ site.rssUrl ? '✓' : '-' }}</td>
  <td>{{ site.collectionIntervalMinutes }}分钟</td>
  <td>
    <span v-if="(site.consecutiveFailures ?? 0) > 0" class="failure-badge">{{ site.consecutiveFailures }}次</span>
    <span v-else>-</span>
          </td>
          <td>{{ formatNullableTime(site.lastSuccessAt) }}</td>
          <td :title="site.lastFailureReason || ''">{{ site.lastFailureReason ? formatNullableTime(site.lastFailureAt) : '-' }}</td>
          <td>{{ formatNullableTime(site.nextRetryAt) }}</td>
          <td>
            <span :class="site.enabled ? 'status-on' : 'status-off'">{{ site.enabled ? '启用' : '停用' }}</span>
          </td>
          <td class="action-cell">
            <button type="button" class="btn-sm" title="编辑" @click="openEditDialog(site)">编辑</button>
            <button type="button" class="btn-sm" @click="toggleSite(site)">{{ site.enabled ? '停用' : '启用' }}</button>
            <button type="button" class="btn-sm" @click="triggerCollect(site.id)">采集</button>
            <button type="button" class="btn-sm btn-danger" title="删除" @click="deleteSite(site)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 网站编辑/详情抽屉 -->
    <div v-if="dialogVisible" class="drawer-overlay" @click.self="closeDialog">
      <aside class="site-drawer">
        <div class="drawer-header">
          <div>
            <span class="drawer-eyebrow">{{ isEditing ? '编辑网站' : '新增网站' }}</span>
            <h3>{{ isEditing ? form.name || '编辑' : '新增网站' }}</h3>
          </div>
          <button class="icon-button close-button" aria-label="关闭" title="关闭" @click="closeDialog">&times;</button>
        </div>
        <div class="drawer-body">
          <label class="form-field">
            <span>网站名称 *</span>
            <input v-model="form.name" placeholder="输入网站名称" :disabled="saving" />
          </label>
          <label class="form-field">
            <span>网站地址 *</span>
            <input v-model="form.url" placeholder="https://example.com" :disabled="saving" />
          </label>
          <label class="form-field">
            <span>所属分类 *</span>
            <select v-model.number="form.categoryId" :disabled="saving">
              <option :value="0" disabled>选择分类</option>
              <option v-for="cat in selectableCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </label>
          <label class="form-field">
            <span>RSS 地址</span>
            <input v-model="form.rssUrl" placeholder="https://example.com/rss.xml（可选）" :disabled="saving" />
          </label>
          <label class="form-field">
            <span>采集间隔（分钟）</span>
            <input v-model.number="form.collectionIntervalMinutes" type="number" min="10" placeholder="1440" :disabled="saving" />
          </label>
          <label class="form-field" v-if="isEditing">
            <span>启用状态</span>
            <select v-model="form.enabledBoolean" :disabled="saving">
              <option :value="true">启用</option>
              <option :value="false">停用</option>
            </select>
          </label>

          <!-- 失败信息展示 -->
          <div v-if="isEditing && form.consecutiveFailures > 0" class="failure-info">
            <strong>采集异常</strong>
            <p>连续失败 {{ form.consecutiveFailures }} 次</p>
            <p v-if="form.lastFailureReason">原因：{{ form.lastFailureReason }}</p>
            <p v-if="form.lastFailureAt">最近失败：{{ formatTime(form.lastFailureAt) }}</p>
            <p v-if="form.nextRetryAt">下次自动重试：{{ formatTime(form.nextRetryAt) }}</p>
          </div>
          <div v-if="isEditing && form.lastSuccessAt" class="success-info">
            <strong>最近成功</strong>
            <p>{{ formatTime(form.lastSuccessAt) }}</p>
          </div>

          <div class="drawer-actions">
            <button type="button" class="btn-secondary" @click="closeDialog" :disabled="saving">取消</button>
            <button type="button" @click="saveSite" :disabled="!isFormValid || saving">
              {{ saving ? '保存中...' : (isEditing ? '保存修改' : '创建网站') }}
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 确认操作气泡弹窗 -->
    <div v-if="confirmVisible" class="confirm-overlay" @click.self="cancelConfirm">
      <div class="confirm-dialog">
        <strong class="confirm-title">{{ confirmTitle }}</strong>
        <p class="confirm-message">{{ confirmMessage }}</p>
        <div class="confirm-actions">
          <button type="button" class="btn-secondary" @click="cancelConfirm">取消</button>
          <button type="button" class="btn-danger" @click="executeConfirm">{{ confirmBtnText || '确认' }}</button>
        </div>
      </div>
    </div>

    <!-- Toast 提示容器 -->
    <div class="toast-container">
      <div v-for="t in toasts" :key="t.id" :class="['toast-item', 'toast-' + t.type]">
        <span class="toast-text">{{ t.msg }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { siteApi } from '@/api/sites';
import { categoryApi } from '@/api/categories';
import { collectionRunApi } from '@/api/collectionRuns';
import type { Site, Category } from '@/types';

const sites = ref<Site[]>([]);
const categories = ref<Category[]>([]);
const selectableCategories = computed(() =>
  categories.value.filter((category) => !category.archived || category.id === form.value.categoryId)
);
const loading = ref(true);
const dialogVisible = ref(false);
const isEditing = ref(false);
const saving = ref(false);

interface SiteForm {
  name: string;
  url: string;
  categoryId: number;
  rssUrl: string;
  collectionIntervalMinutes: number;
  enabledBoolean: boolean;
  consecutiveFailures: number;
  lastFailureReason: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
}

const emptyForm = (): SiteForm => ({
  name: '', url: '', categoryId: 0, rssUrl: '',
  collectionIntervalMinutes: 1440, enabledBoolean: true,
  consecutiveFailures: 0, lastFailureReason: null, lastFailureAt: null,
  lastSuccessAt: null, nextRetryAt: null,
});
const form = ref<SiteForm>(emptyForm());
let editingSite: Site | null = null;
let pendingAction: (() => Promise<void>) | null = null;
const confirmVisible = ref(false);
const confirmTitle = ref('');
const confirmMessage = ref('');
const confirmBtnText = ref('确认');

const isFormValid = computed(() =>
  form.value.name.trim() && form.value.url.trim() && form.value.categoryId > 0
);

async function load() {
  loading.value = true;
  try {
    const [siteRes, catRes] = await Promise.all([siteApi.list(), categoryApi.list()]);
    sites.value = siteRes.data.data;
    categories.value = catRes.data.data;
  } catch {}
  loading.value = false;
}

function categoryName(id: number) {
  return categories.value.find(c => c.id === id)?.name || '-';
}

/**
 * 格式化后端 ISO 时间字符串。
 * <p>站点健康状态字段允许为空，调用前应使用 {@link formatNullableTime} 做空值保护。</p>
 */
function formatTime(t: string) {
  return new Date(t).toLocaleString('zh-CN');
}

/** 格式化可空时间字段，避免空值在表格中显示 Invalid Date。 */
function formatNullableTime(t: string | null | undefined) {
  return t ? formatTime(t) : '-';
}

function openCreateDialog() {
  isEditing.value = false;
  form.value = emptyForm();
  editingSite = null;
  dialogVisible.value = true;
}

function openEditDialog(site: Site) {
  isEditing.value = true;
  editingSite = site;
  form.value = {
    name: site.name, url: site.url, categoryId: site.categoryId,
    rssUrl: site.rssUrl || '', collectionIntervalMinutes: site.collectionIntervalMinutes,
    enabledBoolean: site.enabled,
    consecutiveFailures: site.consecutiveFailures || 0,
    lastFailureReason: site.lastFailureReason || null,
    lastFailureAt: site.lastFailureAt || null,
    lastSuccessAt: site.lastSuccessAt || null,
    nextRetryAt: site.nextRetryAt || null,
  };
  dialogVisible.value = true;
}

function closeDialog() {
  dialogVisible.value = false;
  editingSite = null;
}

/** 展示确认气泡弹窗 */
function showConfirm(title: string, message: string, action: () => Promise<void>, btnText = '确认') {
  confirmTitle.value = title;
  confirmMessage.value = message;
  confirmBtnText.value = btnText;
  pendingAction = action;
  confirmVisible.value = true;
}

function cancelConfirm() {
  confirmVisible.value = false;
  pendingAction = null;
}

/** 轮询中的定时器集合，用于页面销毁时统一清理 */
const pollTimers: ReturnType<typeof setInterval>[] = [];

/** 轮询采集任务状态，完成后弹出提示 */
function pollRunStatus(runId: number) {
  const timer = setInterval(async () => {
    try {
      const res = await collectionRunApi.get(runId);
      const run = res.data.data;
      if (run.status === 'COMPLETED') {
        clearInterval(timer);
        showToast(`采集完成，收获 ${run.collectedCount} 篇文章`, 'success');
      } else if (run.status === 'FAILED') {
        clearInterval(timer);
        const reason = run.errorMessage || '未知错误';
        showToast(`采集失败：${reason}`, 'error');
      }
    } catch {
      clearInterval(timer);
    }
  }, 2000);
  pollTimers.push(timer);
}

/** 页面卸载时清理所有轮询定时器 */
onUnmounted(() => {
  pollTimers.forEach(t => clearInterval(t));
  pollTimers.length = 0;
});

async function executeConfirm() {
  const action = pendingAction;
  cancelConfirm();
  if (action) await action();
}

async function saveSite() {
  if (!isFormValid.value || saving.value) return;
  saving.value = true;
  try {
    const payload = {
      name: form.value.name,
      url: form.value.url,
      categoryId: form.value.categoryId,
      collectionIntervalMinutes: form.value.collectionIntervalMinutes,
      rssUrl: form.value.rssUrl || undefined,
    };
    
    if (isEditing.value && editingSite) {
      await siteApi.update(editingSite.id, { ...payload, enabled: form.value.enabledBoolean });
      showToast('网站更新成功', 'success');
    } else {
      await siteApi.create(payload);
      showToast('网站创建成功', 'success');
    }
    closeDialog();
    await load();
  } catch {
    showToast('操作失败，请重试', 'error');
  } finally {
    saving.value = false;
  }
}

async function toggleSite(site: Site) {
  const action = site.enabled ? '停用' : '启用';
  showConfirm(
    `${action}网站`,
    `确定要${action}「${site.name}」吗？`,
    async () => {
      try {
        await siteApi.update(site.id, { enabled: !site.enabled });
        showToast(`网站已${action}`, 'success');
        await load();
      } catch {
        showToast('操作失败', 'error');
      }
    },
    action
  );
}

async function triggerCollect(siteId: number) {
  try {
    const res = await collectionRunApi.trigger(siteId);
    const runId = (res.data as any).data.runId;
    showToast('采集任务已提交', 'success');
    pollRunStatus(runId);
  } catch {
    showToast('触发采集失败', 'error');
  }
}

async function deleteSite(site: Site) {
  showConfirm(
    '删除网站',
    `确定删除「${site.name}」？此操作不可恢复。`,
    async () => {
      try {
        await siteApi.delete(site.id);
        showToast('网站已删除', 'success');
        await load();
      } catch {
        showToast('删除失败', 'error');
      }
    },
    '删除'
  );
}

/** Toast 提示 */
const toasts = ref<{id:number;msg:string;type:string}[]>([]);
let nextToastId = 1;
function showToast(msg: string, type: 'success'|'error'|'info' = 'info') {
  const id = nextToastId++;
  toasts.value.push({id, msg, type});
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, 3000);
}

onMounted(load);
</script>

<style scoped>
.data-table { border-collapse: collapse; width: 100%; }
.data-table th, .data-table td {
  border-bottom: 1px solid #e3e9e6;
  padding: 10px 8px;
  text-align: left;
  vertical-align: middle;
}
.data-table th { color: #5e6b67; font-size: 13px; font-weight: 600; white-space: nowrap; }
.data-table td { font-size: 14px; }
.data-table a { color: #136f63; text-decoration: none; }
.data-table a:hover { text-decoration: underline; }
.action-cell { white-space: nowrap; }
.btn-sm {
  background: #eef4f2;
  border: none;
  border-radius: 5px;
  color: #136f63;
  cursor: pointer;
  font-size: 13px;
  margin-right: 4px;
  padding: 6px 10px;
  transition: background 0.15s;
}
.btn-sm:hover { background: #dce8e5; }
.btn-secondary { background: #e3e9e6; color: #17202a; }
.btn-secondary:hover { background: #d0d9d5; }
.btn-danger { background: #fdecea; color: #a5362f; }
.btn-danger:hover { background: #f5cdc9; }
.status-on { color: #1a7a3a; font-weight: 600; }
.status-off { color: #a5362f; }
.failure-badge {
  background: #fdecea;
  border-radius: 10px;
  color: #a5362f;
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
}

/* Toast 提示 */
.toast-container {
  bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  position: fixed;
  right: 24px;
  z-index: 1001;
}
.toast-item {
  align-items: center;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  display: flex;
  gap: 10px;
  max-width: 380px;
  padding: 14px 18px;
  pointer-events: auto;
}
.toast-success { border-left: 4px solid #1a7a3a; color: #1a7a3a; }
.toast-error { border-left: 4px solid #a5362f; color: #a5362f; }

/* 确认气泡弹窗 */
.confirm-overlay {
  align-items: center;
  background: rgba(16, 35, 31, 0.42);
  bottom: 0;
  display: flex;
  justify-content: center;
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 1002;
}
.confirm-dialog {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  max-width: 400px;
  padding: 28px 32px 24px;
  width: 90%;
}
.confirm-title { display: block; font-size: 18px; margin-bottom: 8px; }
.confirm-message { color: #53605c; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
.confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }

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
.site-drawer {
  background: #fff;
  box-shadow: -16px 0 32px rgba(23,32,42,0.18);
  display: flex;
  flex-direction: column;
  max-width: 500px;
  overflow-y: auto;
  padding: 24px;
  width: min(500px, 100%);
}
.drawer-header {
  align-items: start;
  border-bottom: 1px solid #e3e9e6;
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr) 34px;
  padding-bottom: 18px;
}
.drawer-header h3 { font-size: 20px; margin: 4px 0 0; }
.drawer-eyebrow { color: #136f63; font-size: 13px; font-weight: 700; }
.close-button {
  align-items: center;
  background: #eef4f2;
  border: none;
  border-radius: 6px;
  color: #53605c;
  cursor: pointer;
  display: inline-flex;
  font-size: 24px;
  height: 34px;
  justify-content: center;
  line-height: 1;
  padding: 0;
  width: 34px;
}
.drawer-body { display: grid; gap: 16px; padding-top: 18px; }
.form-field { display: grid; gap: 6px; }
.form-field span { color: #3e4c48; font-size: 13px; font-weight: 600; }
.form-field input, .form-field select {
  border: 1px solid #d7dfdc;
  border-radius: 6px;
  color: #17202a;
  font-size: 14px;
  outline: none;
  padding: 10px 14px;
}
.form-field input:focus, .form-field select:focus {
  border-color: #9fc7bf;
  box-shadow: 0 0 0 3px rgba(19,111,99,0.12);
}
.failure-info {
  background: #fdecea;
  border: 1px solid #f5cdc9;
  border-radius: 8px;
  color: #a5362f;
  font-size: 13px;
  padding: 12px;
}
.failure-info p { margin: 4px 0; }
.success-info {
  background: #eef7f0;
  border: 1px solid #cfe8d7;
  border-radius: 8px;
  color: #1a7a3a;
  font-size: 13px;
  padding: 12px;
}
.success-info p { margin: 4px 0; }
.drawer-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>
