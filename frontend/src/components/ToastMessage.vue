<!--
  ToastMessage - 全局消息提示组件。

  在页面右上角显示操作成功/失败/警告提示，3秒后自动消失。
  通过 provide/inject 或 event bus 触发。

  @usage: 在父组件中调用 addToast('操作成功', 'success')
-->
<template>
  <div class="toast-container">
    <transition-group name="toast">
      <div v-for="toast in toasts" :key="toast.id" :class="['toast-item', 'toast-' + toast.type]">
        <span class="toast-icon">{{ iconMap[toast.type] }}</span>
        <span class="toast-text">{{ toast.message }}</span>
        <button class="toast-close" @click="remove(toast.id)">&times;</button>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const iconMap: Record<ToastType, string> = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
};

const toasts = ref<ToastItem[]>([]);
let nextId = 1;

/** 添加一条提示消息 */
function addToast(message: string, type: ToastType = 'info', durationMs = 3000) {
  const id = nextId++;
  toasts.value.push({ id, message, type });
  setTimeout(() => remove(id), durationMs);
}

/** 移除指定 ID 的提示 */
function remove(id: number) {
  toasts.value = toasts.value.filter(t => t.id !== id);
}

defineExpose({ addToast });
</script>

<style scoped>
.toast-container {
  bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  position: fixed;
  right: 24px;
  z-index: 1000;
}
.toast-item {
  align-items: center;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  display: flex;
  gap: 10px;
  padding: 14px 18px;
  pointer-events: auto;
  max-width: 380px;
}
.toast-success { background: #e8f5e9; color: #1a7a3a; border-left: 4px solid #1a7a3a; }
.toast-error { background: #fdecea; color: #a5362f; border-left: 4px solid #a5362f; }
.toast-warning { background: #fff8e1; color: #8a6d00; border-left: 4px solid #8a6d00; }
.toast-info { background: #e3f2fd; color: #1565c0; border-left: 4px solid #1565c0; }
.toast-icon { font-size: 18px; font-weight: 700; }
.toast-text { font-size: 14px; }
.toast-close {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  margin-left: auto;
  opacity: 0.6;
  padding: 0 4px;
}
.toast-close:hover { opacity: 1; }
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from { opacity: 0; transform: translateX(40px); }
.toast-leave-to { opacity: 0; transform: translateX(40px); }
</style>
