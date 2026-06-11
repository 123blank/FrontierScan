<template>
  <main class="login-page">
    <section class="login-panel">
      <div class="login-copy">
        <span class="eyebrow">FrontierScan</span>
        <h1>前沿网站信息采集与整理平台</h1>
        <p>管理技术与 AI 信息源，按分类查看 Agent 整理后的摘要和详情。</p>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <label>
          账号
          <input v-model="username" autocomplete="username" placeholder="admin" />
        </label>
        <label>
          密码
          <input v-model="password" autocomplete="current-password" placeholder="任意密码" type="password" />
        </label>
        <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
        <button type="submit" :disabled="loading">{{ loading ? '登录中...' : '登录' }}</button>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();
const username = ref('admin');
const password = ref('admin123');
const loading = ref(false);
const errorMessage = ref('');

async function submit() {
  loading.value = true;
  errorMessage.value = '';
  try {
    await auth.login(username.value, password.value);
    await router.push({ name: 'dashboard' });
  } catch {
    errorMessage.value = '登录失败，请确认后端服务已启动。';
  } finally {
    loading.value = false;
  }
}
</script>
