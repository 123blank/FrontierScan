/**
 * 前端路由配置。
 *
 * 定义应用的页面路由结构：
 * - /login：登录页（公开访问）
 * - /：受保护的主应用区域，包含信息看板、分类管理、网站管理和任务记录页面
 *
 * 路由守卫在每次导航前检查用户认证状态：
 * - 未登录用户访问受保护路由时自动跳转到登录页
 * - 已登录用户访问登录页时自动跳转到信息看板
 *
 * @module router/index
 */
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import LoginView from '@/views/LoginView.vue';
import AppLayout from '@/layouts/AppLayout.vue';
import DashboardView from '@/views/DashboardView.vue';
import CategoriesView from '@/views/CategoriesView.vue';
import SitesView from '@/views/SitesView.vue';
import CollectionRunsView from '@/views/CollectionRunsView.vue';
import FavoritesView from '@/views/FavoritesView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppLayout,
      redirect: '/dashboard',
      meta: { requiresAuth: true },
      children: [
        { path: 'dashboard', name: 'dashboard', component: DashboardView },
        { path: 'categories', name: 'categories', component: CategoriesView },
        { path: 'sites', name: 'sites', component: SitesView },
        { path: 'favorites', name: 'favorites', component: FavoritesView },
        { path: 'collection-runs', name: 'collectionRuns', component: CollectionRunsView },
      ],
    },
  ],
});

/**
 * 导航前置守卫：检查用户认证状态。
 * 未登录 → 重定向到登录页；已登录访问登录页 → 重定向到信息看板。
 */
router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'dashboard' };
  }
  return true;
});

export default router;
