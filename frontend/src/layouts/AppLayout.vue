<!--
  AppLayout - 应用主布局组件。

  提供应用的通用界面框架：
  - 左侧深色侧边栏：品牌标识 + 导航菜单
  - 右侧主内容区：顶部操作栏（标题、搜索、退出） + 页面内容区域

  所有受保护的路由均在此布局内渲染。
-->
<template>
  <div class="app-shell">
    <!-- 侧边栏导航 -->
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">FS</span>
        <div>
          <strong>前沿信息采集</strong>
          <small>技术与 AI 前沿信息 Agent</small>
        </div>
      </div>

      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to">
          <span>{{ item.icon }}</span>
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <!-- 主内容区 -->
    <main class="main-panel">
      <!-- 顶部操作栏 -->
      <header class="topbar">
        <div>
          <h1>{{ currentTitle }}</h1>
          <p>按分类查看文章摘要，点击后进入详情与原文来源。</p>
        </div>
        <div class="topbar-actions">
          <input aria-label="搜索" placeholder="搜索来源、标签或关键词" />
          <button type="button" @click="logout">退出</button>
        </div>
      </header>

      <!-- 页面内容插槽 -->
      <section class="content-surface">
        <RouterView />
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

/** 侧边栏导航项配置 */
const navItems = [
  { to: '/dashboard', label: '信息看板', icon: '◆' },
  { to: '/categories', label: '分类管理', icon: '▣' },
  { to: '/sites', label: '网站管理', icon: '◎' },
  { to: '/collection-runs', label: '任务记录', icon: '◷' },
];

/** 页面标题映射表 */
const titles: Record<string, string> = {
  dashboard: '信息看板',
  categories: '分类管理',
  sites: '网站管理',
  collectionRuns: '任务记录',
};

/** 根据当前路由名称计算页面标题 */
const currentTitle = computed(() => titles[String(route.name)] ?? 'FrontierScan');

/** 登出操作：清除认证状态并跳转到登录页 */
function logout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>