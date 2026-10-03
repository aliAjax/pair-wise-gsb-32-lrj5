<template>
  <GlobalErrorBoundary>
    <nav class="app-nav">
      <strong>TripWeaver</strong>
      <RouterLink to="/trips">我的旅行</RouterLink>
      <RouterLink to="/spots">景点探索</RouterLink>
      <RouterLink to="/share">分享预览</RouterLink>
      <el-select v-model="themeStore.theme" size="small" @change="themeStore.setTheme" style="width: 120px">
        <el-option label="清爽地图" value="fresh" />
        <el-option label="傍晚地图" value="dusk" />
      </el-select>
    </nav>
    <SyncPanel />
    <RouterView />
  </GlobalErrorBoundary>
</template>
<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import GlobalErrorBoundary from './components/common/GlobalErrorBoundary';
import SyncPanel from './components/common/SyncPanel.vue';
import { useThemeStore } from './stores/themeStore';
import { useSyncStore } from './stores/syncStore';
const themeStore = useThemeStore();
const syncStore = useSyncStore();
onMounted(() => syncStore.init());
</script>
<style scoped>
.app-nav { display: flex; gap: 18px; align-items: center; padding: 14px 28px; background: #1f3d2b; color: #f7ffe8; flex-wrap: wrap; }
.router-link-active { text-decoration: underline; }
</style>
