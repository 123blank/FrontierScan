<!--
  LoginView - 用户登录页。

  提供用户名和密码输入表单，调用后端 /api/auth/login 接口完成认证。
  登录成功后自动跳转到信息看板。页面背景使用渐变 + 实景图设计。
-->
<template>
  <main class="login-page">
    <section class="login-panel">
      <!-- 左侧品牌文案区 -->
      <div class="login-copy">
        <span class="eyebrow">FrontierScan</span>
        <h1>前沿网站信息采集与整理平台</h1>
        <p>管理技术与 AI 信息源，按分类查看 Agent 整理后的摘要和详情。</p>
      </div>

      <!-- 右侧登录表单 -->
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

/** 用户名输入框绑定值，默认填充 admin */
const username = ref('admin');
/** 密码输入框绑定值，默认填充 admin123 */
const password = ref('admin123');
/** 登录请求是否正在加载中 */
const loading = ref(false);
/** 登录失败时的错误提示信息 */
const errorMessage = ref('');

/** 提交登录表单：调用认证接口，成功则跳转到信息看板 */
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