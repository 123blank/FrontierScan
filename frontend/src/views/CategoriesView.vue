<!--
  CategoriesView - 分类管理页面。

  提供分类的创建、归档/恢复和删除操作。
  分类信息以表格形式展示，包含名称、描述、排序和状态字段。
-->
<template>
  <section class="section-block">
    <div class="section-heading">
      <h2>分类管理</h2>
      <button type="button" @click="showForm = true">新增分类</button>
    </div>

    <!-- 新增分类内联表单 -->
    <div v-if="showForm" class="inline-form">
      <input v-model="form.name" placeholder="分类名称" />
      <input v-model="form.description" placeholder="描述（可选）" />
      <input v-model.number="form.sortOrder" type="number" placeholder="排序" />
      <button type="button" @click="createCategory" :disabled="!form.name">保存</button>
      <button type="button" class="btn-secondary" @click="cancelForm">取消</button>
    </div>

    <!-- 分类列表 -->
    <div v-if="loading" class="empty-state"><p>加载中...</p></div>
    <div v-else-if="categories.length === 0" class="empty-state">
      <strong>还没有分类</strong>
      <p>创建分类来组织你的信息源。</p>
    </div>
    <table v-else class="data-table">
      <thead>
        <tr><th>名称</th><th>描述</th><th>排序</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="cat in categories" :key="cat.id">
          <td>{{ cat.name }}</td>
          <td>{{ cat.description || '-' }}</td>
          <td>{{ cat.sortOrder }}</td>
          <td>{{ cat.archived ? '已归档' : '正常' }}</td>
          <td>
            <button type="button" class="btn-sm" @click="toggleArchive(cat)">{{ cat.archived ? '恢复' : '归档' }}</button>
            <button type="button" class="btn-sm btn-danger" @click="deleteCategory(cat.id)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { categoryApi } from '@/api/categories';
import type { Category } from '@/types';

/** 分类列表数据 */
const categories = ref<Category[]>([]);
const loading = ref(true);
/** 是否显示新增表单 */
const showForm = ref(false);
/** 新增分类表单数据 */
const form = ref({ name: '', description: '', sortOrder: 0 });

/** 加载分类列表 */
async function load() {
  loading.value = true;
  try {
    const res = await categoryApi.list(true);
    categories.value = res.data.data;
  } catch { /* 后端不可用时不展示错误 */ }
  loading.value = false;
}

/** 创建新分类 */
async function createCategory() {
  await categoryApi.create({
    name: form.value.name,
    description: form.value.description || undefined,
    sortOrder: form.value.sortOrder,
  });
  form.value = { name: '', description: '', sortOrder: 0 };
  showForm.value = false;
  await load();
}

/** 取消新增 */
function cancelForm() {
  form.value = { name: '', description: '', sortOrder: 0 };
  showForm.value = false;
}

/** 切换分类的归档状态 */
async function toggleArchive(cat: Category) {
  await categoryApi.update(cat.id, { archived: !cat.archived });
  await load();
}

/** 删除分类 */
async function deleteCategory(id: number) {
  if (!confirm('确定删除此分类？')) return;
  await categoryApi.delete(id);
  await load();
}

onMounted(load);
</script>

<style scoped>
.inline-form { background: #f8faf9; border: 1px solid #e3e9e6; border-radius: 8px; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; padding: 12px; }
.inline-form input { flex: 1; min-width: 120px; }
.data-table { border-collapse: collapse; width: 100%; }
.data-table th, .data-table td { border-bottom: 1px solid #e3e9e6; padding: 12px 8px; text-align: left; }
.data-table th { color: #5e6b67; font-size: 13px; font-weight: 600; }
.btn-sm { font-size: 13px; margin-right: 6px; padding: 6px 10px; }
.btn-secondary { background: #e3e9e6; color: #17202a; }
.btn-danger { background: #a5362f; }
</style>