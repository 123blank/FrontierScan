<!--
  CollectionRunsView - 采集任务记录页面。

  展示所有手动和定时采集任务的执行历史，包括任务类型、状态、
  时间区间、耗时、采集数量和错误信息。
-->
<template>
  <section class="section-block">
    <div class="section-heading">
      <h2>采集任务记录</h2>
      <button type="button" @click="load">刷新</button>
    </div>

    <div v-if="loading" class="empty-state"><p>加载中...</p></div>
    <div v-else-if="runs.length === 0" class="empty-state">
      <strong>暂无采集任务</strong>
      <p>在「网站管理」中触发手动采集后，记录会在此显示。</p>
    </div>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>任务类型</th><th>状态</th><th>开始时间</th><th>结束时间</th>
          <th>耗时</th><th>采集数量</th><th>错误信息</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="run in runs" :key="run.id">
          <td>{{ run.runType === 'MANUAL' ? '手动' : '定时' }}</td>
          <td><span :class="'status-' + run.status.toLowerCase()">{{ statusText(run.status) }}</span></td>
          <td>{{ formatTime(run.startedAt) }}</td>
          <td>{{ run.finishedAt ? formatTime(run.finishedAt) : '-' }}</td>
          <td>{{ run.finishedAt ? duration(run.startedAt, run.finishedAt) : '-' }}</td>
          <td>{{ run.collectedCount }}</td>
          <td class="error-cell">{{ run.errorMessage || '-' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { collectionRunApi } from '@/api/collectionRuns';
import type { CollectionRun } from '@/types';

const runs = ref<CollectionRun[]>([]);
const loading = ref(true);

/** 加载任务记录列表 */
async function load() {
  loading.value = true;
  try {
    const res = await collectionRunApi.list();
    runs.value = res.data.data;
  } catch { /* 后端不可用时不展示错误 */ }
  loading.value = false;
}

/** 将任务状态码转为中文显示文本 */
function statusText(status: string) {
  const map: Record<string, string> = { RUNNING: '运行中', COMPLETED: '完成', FAILED: '失败' };
  return map[status] || status;
}

/** 格式化 ISO 时间戳为本地可读时间 */
function formatTime(t: string) {
  return new Date(t).toLocaleString('zh-CN');
}

/** 计算两个 ISO 时间戳之间的耗时（秒或分钟+秒） */
function duration(start: string, end: string) {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return secs + '秒';
  return Math.floor(secs / 60) + '分' + (secs % 60) + '秒';
}

onMounted(load);
</script>

<style scoped>
.data-table { border-collapse: collapse; width: 100%; }
.data-table th, .data-table td { border-bottom: 1px solid #e3e9e6; padding: 12px 8px; text-align: left; }
.data-table th { color: #5e6b67; font-size: 13px; font-weight: 600; }
.error-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-running { color: #136f63; font-weight: 600; }
.status-completed { color: #1a7a3a; }
.status-failed { color: #a5362f; }
</style>