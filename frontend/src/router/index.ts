import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import LoginView from '@/views/LoginView.vue';
import AppLayout from '@/layouts/AppLayout.vue';
import DashboardView from '@/views/DashboardView.vue';
import CategoriesView from '@/views/CategoriesView.vue';
import SitesView from '@/views/SitesView.vue';
import CollectionRunsView from '@/views/CollectionRunsView.vue';

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
        { path: 'collection-runs', name: 'collectionRuns', component: CollectionRunsView },
      ],
    },
  ],
});

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
