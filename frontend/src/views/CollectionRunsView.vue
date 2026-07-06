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
          <th>耗时</th><th>采集数量</th><th>失败类型</th><th>失败阶段</th>
          <th>重试</th><th>下次重试</th><th>错误/告警</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="run in runs" :key="run.id">
          <td data-label="任务类型">{{ runTypeText(run.runType) }}</td>
          <td data-label="状态"><span :class="'status-' + run.status.toLowerCase()">{{ statusText(run.status) }}</span></td>
          <td data-label="开始时间">{{ formatTime(run.startedAt) }}</td>
          <td data-label="结束时间">{{ run.finishedAt ? formatTime(run.finishedAt) : '-' }}</td>
          <td data-label="耗时">{{ run.finishedAt ? duration(run.startedAt, run.finishedAt) : '-' }}</td>
          <td data-label="采集数量">{{ run.collectedCount }}</td>
          <td data-label="失败类型">{{ failureTypeText(run.failureType) }}</td>
          <td data-label="失败阶段">{{ failureStageText(run.failureStage) }}</td>
          <td data-label="重试">{{ run.retryCount || 0 }}</td>
          <td data-label="下次重试">{{ formatNullableTime(run.nextRetryAt) }}</td>
          <td data-label="错误/告警" class="error-cell" :title="run.errorMessage || run.warningMessage || ''">
            {{ run.errorMessage || run.warningMessage || '-' }}
          </td>
          <td data-label="操作" class="action-cell">
            <button v-if="run.status === 'FAILED'" type="button" class="retry-btn"
                    :disabled="retrying.has(run.id)" @click="retryRun(run.id)">
              重试
            </button>
            <button v-if="run.siteId" type="button" class="retry-btn"
                    :disabled="retrying.has(run.id)" @click="collectSite(run.siteId)">
              重新采集
            </button>
          </td>
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
const retrying = ref<Set<number>>(new Set());

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

/** 将任务类型转为业务可读文本，便于区分普通采集和重试采集。 */
function runTypeText(runType: string) {
  const map: Record<string, string> = {
    MANUAL: '手动',
    SCHEDULED: '定时',
    MANUAL_RETRY: '手动重试',
    SCHEDULED_RETRY: '自动重试',
  };
  return map[runType] || runType;
}

/** 将稳定失败类型转为中文，前端展示不依赖后端错误文案。 */
function failureTypeText(type: string | null) {
  if (!type) return '-';
  const map: Record<string, string> = {
    NETWORK_TIMEOUT: '网络超时',
    RSS_PARSE_ERROR: 'RSS错误',
    HTML_PARSE_ERROR: 'HTML解析失败',
    EMPTY_RESULT: '空结果',
    LLM_SUMMARY_FAILED: 'LLM摘要失败',
    UNKNOWN: '未知错误',
  };
  return map[type] || type;
}

/** 将失败阶段转为中文，帮助快速定位采集链路中的故障位置。 */
function failureStageText(stage: string | null) {
  if (!stage) return '-';
  const map: Record<string, string> = {
    RSS: 'RSS',
    HTML: 'HTML',
    LLM_SUMMARY: 'LLM摘要',
    UNKNOWN: '未知',
  };
  return map[stage] || stage;
}

/** 重试失败的采集任务 */
async function retryRun(runId: number) {
  const pending = new Set(retrying.value);
  pending.add(runId);
  retrying.value = pending;
  try {
    await collectionRunApi.retry(runId);
    await load();
  } catch {}
  const latest = new Set(retrying.value);
  latest.delete(runId);
  retrying.value = latest;
}

/** 对任务关联站点立即发起一次手动采集，适用于任意带站点的历史任务。 */
async function collectSite(siteId: number) {
  try {
    await collectionRunApi.trigger(siteId);
    await load();
  } catch {}
}

/** 格式化 ISO 时间戳为本地可读时间 */
function formatTime(t: string) {
  return new Date(t).toLocaleString('zh-CN');
}

/** 格式化可空时间字段，空值统一展示为短横线。 */
function formatNullableTime(t: string | null | undefined) {
  return t ? formatTime(t) : '-';
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
.action-cell { display: flex; gap: 6px; white-space: nowrap; }
.status-running { color: #136f63; font-weight: 600; }
.status-completed { color: #1a7a3a; }
.status-failed { color: #a5362f; }

.retry-btn {
  background: #eef4f2;
  border: none;
  border-radius: 5px;
  color: #136f63;
  cursor: pointer;
  font-size: 13px;
  padding: 6px 10px;
  transition: background 0.15s;
}
.retry-btn:hover { background: #dce8e5; }
.retry-btn:disabled { opacity: 0.6; cursor: wait; }

@media (max-width: 980px) {
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
    grid-template-columns: 88px minmax(0, 1fr);
    padding: 8px 0;
  }
  .data-table td::before {
    color: #67726f;
    content: attr(data-label);
    font-size: 13px;
    font-weight: 600;
  }
  .error-cell {
    max-width: none;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }
  .action-cell {
    display: grid !important;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    white-space: normal;
  }
  .retry-btn {
    width: 100%;
  }
}
</style>
