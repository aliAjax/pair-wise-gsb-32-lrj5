import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import './style.css';
import App from './App.vue';
import router from './router';
import { useSyncStore } from './stores/syncStore';

async function bootstrap() {
  const pinia = createPinia();
  const app = createApp(App);
  app.use(pinia);
  // 重联结果 / 分叉包先就位，再渲染列表、当天路线与分享页，保证三页同读一份结果
  await useSyncStore(pinia).init();
  app.use(router).use(ElementPlus).mount('#app');
}

bootstrap();
