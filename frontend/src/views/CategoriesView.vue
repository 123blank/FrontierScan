<!--
  CategoriesView - category management page.
  Create/edit actions use modal dialogs; long descriptive data is shown in detail view.
-->
<template>
  <section class="section-block category-page">
    <div class="section-heading category-heading">
      <div>
        <h2>分类管理</h2>
        <p>维护信息源归属，用于网站配置和看板分类阅读。</p>
      </div>
      <div class="heading-actions">
        <label class="archive-toggle">
          <input type="checkbox" v-model="includeArchived" @change="load" />
          显示已归档
        </label>
        <button type="button" @click="openCreateDialog">新增分类</button>
      </div>
    </div>

    <p v-if="message" class="page-message" :class="{ error: messageType === 'error' }">{{ message }}</p>

    <div v-if="loading" class="empty-state"><p>加载中...</p></div>
    <div v-else-if="categories.length === 0" class="empty-state">
      <strong>还没有分类</strong>
      <p>先创建分类，再到网站管理中添加信息源。</p>
    </div>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th>分类名称</th>
          <th>排序</th>
          <th>使用情况</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="cat in categories" :key="cat.id" :class="{ archived: cat.archived }">
          <td data-label="分类名称">
            <strong>{{ cat.name }}</strong>
          </td>
          <td data-label="排序">{{ cat.sortOrder }}</td>
          <td data-label="使用情况">
            <span class="usage-chip">{{ cat.siteCount || 0 }} 个网站</span>
            <span class="usage-chip">{{ cat.articleCount || 0 }} 篇文章</span>
          </td>
          <td data-label="状态">
            <span class="status-pill" :class="{ muted: cat.archived }">
              {{ cat.archived ? '已归档' : '正常' }}
            </span>
          </td>
          <td data-label="操作">
            <div class="row-actions">
              <button type="button" class="btn-sm btn-secondary" @click="openDetailDialog(cat)">详情</button>
              <button type="button" class="btn-sm" @click="openEditDialog(cat)">编辑</button>
              <button type="button" class="btn-sm btn-secondary" @click="toggleArchive(cat)">
                {{ cat.archived ? '恢复' : '归档' }}
              </button>
              <button
                type="button"
                class="btn-sm btn-danger"
                :disabled="hasUsage(cat)"
                :title="deleteTitle(cat)"
                @click="deleteCategory(cat)"
              >
                删除
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="formDialogOpen" class="modal-overlay" @click.self="closeFormDialog">
      <section class="modal-panel" aria-label="分类设置">
        <div class="modal-header">
          <div>
            <span class="modal-eyebrow">{{ editingId ? '编辑分类' : '新增分类' }}</span>
            <h3>{{ editingId ? '设置分类信息' : '创建信息分类' }}</h3>
          </div>
          <button type="button" class="icon-button" aria-label="关闭" title="关闭" @click="closeFormDialog">&times;</button>
        </div>

        <div class="modal-body">
          <label class="form-field">
            <span>分类名称 *</span>
            <input v-model="form.name" placeholder="例如：AI 前沿" :disabled="saving" />
          </label>

          <label class="form-field">
            <span>描述</span>
            <textarea v-model="form.description" placeholder="说明这个分类收纳的信息源范围" :disabled="saving"></textarea>
          </label>

          <label class="form-field">
            <span>排序</span>
            <input v-model.number="form.sortOrder" type="number" :disabled="saving" />
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" :disabled="saving" @click="closeFormDialog">取消</button>
          <button type="button" :disabled="saving || !form.name.trim()" @click="saveCategory">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="detailDialogOpen && selectedCategory" class="modal-overlay" @click.self="closeDetailDialog">
      <section class="modal-panel detail-panel" aria-label="分类详情">
        <div class="modal-header">
          <div>
            <span class="modal-eyebrow">分类详情</span>
            <h3>{{ selectedCategory.name }}</h3>
          </div>
          <button type="button" class="icon-button" aria-label="关闭" title="关闭" @click="closeDetailDialog">&times;</button>
        </div>

        <div class="detail-grid">
          <div>
            <span>状态</span>
            <strong>{{ selectedCategory.archived ? '已归档' : '正常' }}</strong>
          </div>
          <div>
            <span>排序</span>
            <strong>{{ selectedCategory.sortOrder }}</strong>
          </div>
          <div>
            <span>网站数</span>
            <strong>{{ selectedCategory.siteCount || 0 }}</strong>
          </div>
          <div>
            <span>文章数</span>
            <strong>{{ selectedCategory.articleCount || 0 }}</strong>
          </div>
        </div>

        <section class="detail-section">
          <h4>描述</h4>
          <p>{{ selectedCategory.description || '暂无描述' }}</p>
        </section>

        <section class="detail-section meta-section">
          <div>
            <span>创建时间</span>
            <strong>{{ formatDateTime(selectedCategory.createdAt) }}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{{ formatDateTime(selectedCategory.updatedAt) }}</strong>
          </div>
        </section>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="closeDetailDialog">关闭</button>
          <button type="button" @click="openEditFromDetail">编辑</button>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { categoryApi } from '@/api/categories';
import type { Category } from '@/types';

const categories = ref<Category[]>([]);
const loading = ref(true);
const saving = ref(false);
const includeArchived = ref(true);
const formDialogOpen = ref(false);
const detailDialogOpen = ref(false);
const editingId = ref<number | null>(null);
const selectedCategory = ref<Category | null>(null);
const message = ref('');
const messageType = ref<'info' | 'error'>('info');
const form = ref({ name: '', description: '', sortOrder: 0 });

async function load() {
  loading.value = true;
  try {
    const res = await categoryApi.list(includeArchived.value);
    categories.value = res.data.data;
  } catch {
    showMessage('分类列表加载失败，请确认后端服务是否正常。', 'error');
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  editingId.value = null;
  selectedCategory.value = null;
  form.value = { name: '', description: '', sortOrder: 0 };
  formDialogOpen.value = true;
  message.value = '';
}

function openEditDialog(cat: Category) {
  editingId.value = cat.id;
  selectedCategory.value = cat;
  form.value = {
    name: cat.name,
    description: cat.description || '',
    sortOrder: cat.sortOrder,
  };
  formDialogOpen.value = true;
  message.value = '';
}

function closeFormDialog() {
  if (saving.value) return;
  formDialogOpen.value = false;
  editingId.value = null;
  form.value = { name: '', description: '', sortOrder: 0 };
}

async function saveCategory() {
  saving.value = true;
  message.value = '';
  try {
    const payload = {
      name: form.value.name.trim(),
      description: form.value.description.trim() || undefined,
      sortOrder: form.value.sortOrder || 0,
    };
    if (editingId.value) {
      await categoryApi.update(editingId.value, payload);
      showMessage('分类已更新。', 'info');
    } else {
      await categoryApi.create(payload);
      showMessage('分类已创建。', 'info');
    }
    closeFormDialog();
    await load();
  } catch (error: any) {
    showMessage(error?.response?.data?.message || '保存失败，请检查分类名称是否重复。', 'error');
  } finally {
    saving.value = false;
  }
}

function openDetailDialog(cat: Category) {
  selectedCategory.value = cat;
  detailDialogOpen.value = true;
}

function closeDetailDialog() {
  detailDialogOpen.value = false;
  selectedCategory.value = null;
}

function openEditFromDetail() {
  if (!selectedCategory.value) return;
  const category = selectedCategory.value;
  closeDetailDialog();
  openEditDialog(category);
}

async function toggleArchive(cat: Category) {
  try {
    await categoryApi.update(cat.id, { archived: !cat.archived });
    await load();
  } catch (error: any) {
    showMessage(error?.response?.data?.message || '状态更新失败。', 'error');
  }
}

async function deleteCategory(cat: Category) {
  if (hasUsage(cat)) return;
  if (!confirm(`确定删除「${cat.name}」？`)) return;
  try {
    await categoryApi.delete(cat.id);
    showMessage('分类已删除。', 'info');
    await load();
  } catch (error: any) {
    showMessage(error?.response?.data?.message || '删除失败，请先归档或迁移关联数据。', 'error');
  }
}

function hasUsage(cat: Category) {
  return (cat.siteCount || 0) > 0 || (cat.articleCount || 0) > 0;
}

function deleteTitle(cat: Category) {
  return hasUsage(cat)
    ? '已有网站或文章使用该分类，请先归档或迁移关联数据'
    : '删除分类';
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function showMessage(text: string, type: 'info' | 'error') {
  message.value = text;
  messageType.value = type;
}

onMounted(load);
</script>

<style scoped>
.category-page {
  display: grid;
  gap: 16px;
}
.category-heading {
  align-items: flex-start;
  gap: 16px;
}
.category-heading p {
  color: #67726f;
  margin: 6px 0 0;
}
.heading-actions {
  align-items: center;
  display: flex;
  gap: 12px;
}
.archive-toggle {
  align-items: center;
  color: #53605c;
  display: inline-flex;
  gap: 8px;
  white-space: nowrap;
}
.archive-toggle input {
  padding: 0;
}
.page-message {
  background: #eef4f2;
  border-radius: 6px;
  color: #136f63;
  font-size: 13px;
  margin: 0;
  padding: 10px 12px;
}
.page-message.error {
  background: #fff1ef;
  color: #a5362f;
}
.data-table {
  border-collapse: collapse;
  width: 100%;
}
.data-table th,
.data-table td {
  border-bottom: 1px solid #e3e9e6;
  padding: 14px 10px;
  text-align: left;
  vertical-align: middle;
}
.data-table th {
  color: #5e6b67;
  font-size: 13px;
  font-weight: 600;
}
.data-table td strong {
  display: block;
}
tr.archived {
  color: #697672;
}
.usage-chip,
.status-pill {
  background: #eef4f2;
  border-radius: 6px;
  color: #136f63;
  display: inline-flex;
  font-size: 12px;
  margin: 2px 6px 2px 0;
  padding: 5px 8px;
}
.status-pill.muted {
  background: #f1f5f4;
  color: #697672;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.btn-sm {
  font-size: 13px;
  padding: 7px 10px;
}
.btn-secondary {
  background: #e3e9e6;
  color: #17202a;
}
.btn-danger {
  background: #a5362f;
}
.modal-overlay {
  align-items: center;
  background: rgba(16, 35, 31, 0.42);
  bottom: 0;
  display: flex;
  justify-content: center;
  left: 0;
  padding: 24px;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 30;
}
.modal-panel {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 18px 44px rgba(23, 32, 42, 0.22);
  display: grid;
  gap: 18px;
  max-height: calc(100vh - 48px);
  max-width: 520px;
  overflow-y: auto;
  padding: 22px;
  width: min(520px, 100%);
}
.detail-panel {
  max-width: 620px;
}
.modal-header {
  align-items: start;
  border-bottom: 1px solid #e3e9e6;
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr) 34px;
  padding-bottom: 16px;
}
.modal-header h3 {
  font-size: 20px;
  margin: 4px 0 0;
}
.modal-eyebrow {
  color: #136f63;
  font-size: 13px;
  font-weight: 700;
}
.icon-button {
  align-items: center;
  background: #eef4f2;
  border-radius: 6px;
  color: #53605c;
  display: inline-flex;
  font-size: 22px;
  height: 34px;
  justify-content: center;
  padding: 0;
  width: 34px;
}
.modal-body {
  display: grid;
  gap: 14px;
}
.form-field {
  color: #3e4c48;
  display: grid;
  gap: 8px;
  font-size: 14px;
}
.form-field textarea {
  border: 1px solid #d7dfdc;
  border-radius: 6px;
  color: #17202a;
  font: inherit;
  min-height: 104px;
  outline: none;
  padding: 10px 12px;
  resize: vertical;
}
.form-field textarea:focus {
  border-color: #136f63;
  box-shadow: 0 0 0 3px rgba(19, 111, 99, 0.12);
}
.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.detail-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.detail-grid div,
.meta-section div {
  background: #f8faf9;
  border: 1px solid #e3e9e6;
  border-radius: 6px;
  padding: 12px;
}
.detail-grid span,
.meta-section span {
  color: #67726f;
  display: block;
  font-size: 12px;
  margin-bottom: 6px;
}
.detail-grid strong,
.meta-section strong {
  color: #17202a;
  font-size: 15px;
}
.detail-section {
  display: grid;
  gap: 8px;
}
.detail-section h4 {
  font-size: 15px;
  margin: 0;
}
.detail-section p {
  color: #3e4c48;
  line-height: 1.7;
  margin: 0;
  white-space: pre-wrap;
}
.meta-section {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (max-width: 760px) {
  .category-heading,
  .heading-actions,
  .modal-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .detail-grid,
  .meta-section {
    grid-template-columns: 1fr;
  }
  .data-table,
  .data-table tbody,
  .data-table tr,
  .data-table td {
    display: block;
    width: 100%;
  }
  .data-table thead {
    display: none;
  }
  .data-table {
    border-collapse: separate;
    border-spacing: 0;
  }
  .data-table tr {
    border: 1px solid #e3e9e6;
    border-radius: 8px;
    margin-bottom: 12px;
    padding: 12px;
  }
  .data-table td {
    align-items: flex-start;
    border-bottom: 0;
    display: grid;
    gap: 10px;
    grid-template-columns: 76px minmax(0, 1fr);
    padding: 8px 0;
  }
  .data-table td::before {
    color: #67726f;
    content: attr(data-label);
    font-size: 13px;
    font-weight: 600;
  }
  .data-table td strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .usage-chip,
  .status-pill {
    margin-bottom: 6px;
  }
  .row-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .btn-sm {
    justify-content: center;
    min-height: 36px;
    width: 100%;
  }
}
</style>
