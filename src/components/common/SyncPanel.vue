<template>
  <section class="sync-panel">
    <div class="sync-group">
      <span class="sync-label">当前设备</span>
      <el-radio-group :model-value="sync.deviceId" size="small" @change="onDeviceChange">
        <el-radio-button v-for="device in sync.SYNC_DEVICES" :key="device.id" :label="device.id">{{ device.label }}</el-radio-button>
      </el-radio-group>
    </div>
    <div class="sync-group">
      <el-switch :model-value="sync.online" active-text="联网" inactive-text="断网" inline-prompt @change="sync.setOnline(Boolean($event))" />
      <el-tag :type="sync.online ? 'success' : 'warning'" size="small" effect="plain">
        {{ sync.online ? '云端一致' : `离线 · ${sync.pendingCount} 个待合并包` }}
      </el-tag>
      <el-button v-if="sync.online" size="small" :loading="sync.busy" @click="sync.syncRound()">立即合并</el-button>
    </div>
    <div class="sync-group">
      <el-badge :value="sync.unresolvedCount" :hidden="!sync.unresolvedCount" type="danger">
        <el-tag size="small" :type="sync.unresolvedCount ? 'danger' : 'info'">待裁决</el-tag>
      </el-badge>
      <span class="sync-label muted">空间 {{ percent }}%</span>
      <el-progress :percentage="percent" :status="sync.pressureHigh ? 'exception' : undefined" :stroke-width="8" style="width: 120px" />
      <el-button size="small" @click="manualCompact">压缩最旧包</el-button>
      <span v-if="sync.lastSyncAt" class="sync-label muted">上次合并 {{ shortTime }}</span>
    </div>
    <p v-if="sync.compactionReport" class="sync-report">{{ sync.compactionReport }}</p>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import { useSyncStore } from '../../stores/syncStore';
import type { SyncDeviceId } from '../../constants/sync';

const sync = useSyncStore();
const percent = computed(() => Math.min(99, Math.round(sync.storageRatio * 100)));
const shortTime = computed(() => dayjs(sync.lastSyncAt).format('HH:mm:ss'));
function onDeviceChange(value: string | number | boolean) {
  sync.setDevice(String(value) as SyncDeviceId);
}
async function manualCompact() {
  sync.refreshUsage();
  await sync.runCompaction();
  sync.refreshUsage();
}
</script>
<style scoped>
.sync-panel { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; padding: 10px 28px; background: #eef4e8; border-bottom: 1px solid #cddac2; font-size: 13px; }
.sync-group { display: flex; align-items: center; gap: 8px; }
.sync-label { white-space: nowrap; }
.sync-report { width: 100%; margin: 0; color: #a16207; }
.muted { color: #61706b; }
</style>
