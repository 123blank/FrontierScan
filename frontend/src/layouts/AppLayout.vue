<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">FS</span>
        <div>
          <strong>FrontierScan</strong>
          <small>Tech intelligence agent</small>
        </div>
      </div>

      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.to" :to="item.to">
          <span>{{ item.icon }}</span>
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <main class="main-panel">
      <header class="topbar">
        <div>
          <h1>{{ currentTitle }}</h1>
          <p>按分类查看摘要，点击后进入详情与原文来源。</p>
        </div>
        <div class="topbar-actions">
          <input aria-label="搜索" placeholder="搜索来源、标签或关键词" />
          <button type="button" @click="logout">退出</button>
        </div>
      </header>

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

const navItems = [
  { to: '/dashboard', label: '信息看板', icon: '◆' },
  { to: '/categories', label: '分类管理', icon: '▣' },
  { to: '/sites', label: '网站管理', icon: '◎' },
  { to: '/collection-runs', label: '任务记录', icon: '◷' },
];

const titles: Record<string, string> = {
  dashboard: '信息看板',
  categories: '分类管理',
  sites: '网站管理',
  collectionRuns: '任务记录',
};

const currentTitle = computed(() => titles[String(route.name)] ?? 'FrontierScan');

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}
</script>
