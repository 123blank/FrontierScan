<!--
  ArticleFilterBar - 文章筛选栏组件。

  提供关键词搜索（防抖）、标签筛选、发布时间范围筛选功能。
  与现有设计语言保持一致（绿色主色调、浅色背景、圆角）。
  筛选条件变更时通过事件通知父组件。
-->
<template>
  <div class="filter-bar">
    <div class="filter-row">
      <!-- 关键词搜索 -->
      <div class="filter-group search-group">
        <span class="filter-icon">🔍</span>
        <input
          v-model="searchText"
          type="text"
          placeholder="搜索文章标题..."
          class="search-input"
          @input="onSearchInput"
        />
      </div>

      <!-- 标签筛选 -->
      <div class="filter-group select-group">
        <select v-model="selectedTagId" class="filter-select" @change="emitFilterChange">
          <option :value="undefined">全部标签</option>
          <option v-for="tag in allTags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
        </select>
      </div>

      <!-- 日期范围 -->
      <div class="filter-group date-group">
        <input type="date" v-model="startDate" class="date-input" @change="emitFilterChange" />
        <span class="date-separator">~</span>
        <input type="date" v-model="endDate" class="date-input" @change="emitFilterChange" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { tagApi } from '@/api/tags';
import type { TagItem } from '@/types';

const emit = defineEmits<{
  (e: 'filter-change', filters: { keyword?: string; tagId?: number; startDate?: string; endDate?: string }): void;
}>();

/** 搜索关键词 */
const searchText = ref('');
/** 选中标签 ID */
const selectedTagId = ref<number | undefined>(undefined);
/** 起始日期 */
const startDate = ref('');
/** 截止日期 */
const endDate = ref('');
/** 全部标签（从所有领域合并） */
const allTags = ref<TagItem[]>([]);
/** 防抖定时器句柄 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 页面挂载时加载所有标签 */
onMounted(async () => {
  try {
    const res = await tagApi.listDomains();
    const domains = res.data.data;
    // 合并所有领域的标签到平铺列表，去重
    const seen = new Set<number>();
    for (const domain of domains) {
      for (const tag of domain.tags) {
        if (!seen.has(tag.id)) {
          seen.add(tag.id);
          allTags.value.push(tag);
        }
      }
    }
  } catch {
    // 后端未启动时静默降级
  }
});

/** 搜索输入时触发防抖 */
function onSearchInput() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    emitFilterChange();
  }, 300);
}

/** 触发筛选变更事件 */
function emitFilterChange() {
  emit('filter-change', {
    keyword: searchText.value || undefined,
    tagId: selectedTagId.value,
    startDate: startDate.value || undefined,
    endDate: endDate.value || undefined,
  });
}
</script>

<style scoped>
.filter-bar {
  margin: 0 0 20px;
}
.filter-row {
  align-items: center;
  background: #f8faf9;
  border: 1px solid #e3e9e6;
  border-radius: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 20px;
}
.filter-group {
  align-items: center;
  display: flex;
}
.filter-icon {
  color: #67726f;
  font-size: 15px;
  margin-right: 8px;
  user-select: none;
}
.search-group {
  flex: 1;
  min-width: 200px;
}
.search-input {
  background: #fff;
  border: 1px solid #d7dfdc;
  border-radius: 6px;
  color: #17202a;
  font-size: 14px;
  outline: none;
  padding: 10px 14px;
  width: 100%;
}
.search-input:focus {
  border-color: #9fc7bf;
  box-shadow: 0 0 0 3px rgba(19, 111, 99, 0.12);
}
.search-input::placeholder {
  color: #9aa6a2;
}
.select-group {
  min-width: 160px;
}
.filter-select {
  background: #fff;
  border: 1px solid #d7dfdc;
  border-radius: 6px;
  color: #17202a;
  cursor: pointer;
  font-size: 14px;
  outline: none;
  padding: 10px 14px;
  width: 100%;
}
.filter-select:focus {
  border-color: #9fc7bf;
  box-shadow: 0 0 0 3px rgba(19, 111, 99, 0.12);
}
.date-group {
  align-items: center;
  display: flex;
  gap: 8px;
}
.date-input {
  background: #fff;
  border: 1px solid #d7dfdc;
  border-radius: 6px;
  color: #17202a;
  font-size: 14px;
  outline: none;
  padding: 10px 14px;
  width: 150px;
}
.date-input:focus {
  border-color: #9fc7bf;
  box-shadow: 0 0 0 3px rgba(19, 111, 99, 0.12);
}
.date-separator {
  color: #67726f;
  font-size: 16px;
  user-select: none;
}
@media (max-width: 720px) {
  .filter-row {
    flex-direction: column;
    align-items: stretch;
  }
  .search-group, .select-group {
    min-width: 0;
  }
  .date-group {
    flex-wrap: wrap;
  }
  .date-input {
    flex: 1;
    width: auto;
  }
}
</style>
