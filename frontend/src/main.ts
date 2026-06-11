/**
 * FrontierScan 前端应用入口文件。
 *
 * 负责初始化 Vue 应用实例，注册 Pinia 状态管理、Vue Router 路由
 * 和全局样式，挂载到 index.html 的 #app 节点。
 *
 * @module main
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './styles/main.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');