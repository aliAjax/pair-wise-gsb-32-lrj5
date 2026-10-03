<template>
  <section class="conflict-panel band">
    <h3>待裁决（{{ tripConflicts.length }}）</h3>
    <p class="muted">同一时段的两份安排都保留；裁决前不计费用、不出现在分享页。</p>
    <article v-for="conflict in tripConflicts" :key="conflict.id" class="conflict-card">
      <header>
        <strong v-if="conflict.dayIndex">第 {{ conflict.dayIndex }} 天 · {{ conflict.date }} · 同一时段冲突</strong>
        <strong v-else>字段冲突 · {{ fieldLabel(conflict) }}</strong>
      </header>
      <div class="candidates">
        <button
          v-for="candidate in conflict.candidates"
          :key="candidate.bundleId"
          class="candidate"
          :class="{ chosen: conflict.chosenBundleId === candidate.bundleId }"
          :disabled="conflict.resolved || busy"
          @click="choose(conflict.id, candidate.bundleId)"
        >
          <p><el-tag size="small">{{ candidate.deviceLabel }}</el-tag> {{ formatTime(candidate.at) }}</p>
          <p v-if="candidate.item">
            {{ spotName(candidate.item.spot_id) }} · {{ candidate.item.start_time }}-{{ candidate.item.end_time }}
            <span class="muted">（{{ transportText[candidate.item.transport || 'metro'] }}）{{ candidate.item.note }}</span>
          </p>
          <p v-else-if="candidate.field">金额/取值：<strong>{{ candidate.value }}</strong></p>
          <p class="muted">本笔记账 {{ formatCurrency(candidate.amount, tripCurrency) }}</p>
        </button>
      </div>
    </article>
  </section>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PendingConflict } from '../../models/sync';
import { useSyncStore } from '../../stores/syncStore';
import { useSpotStore } from '../../stores/spotStore';
import { transportText, formatCurrency } from '../../utils/formatters';

const props = defineProps<{ tripId?: string; tripCurrency?: string }>();
const sync = useSyncStore();
const spotStore = useSpotStore();
const busy = ref(false);

const tripConflicts = computed(() =>
  sync.conflicts.filter((conflict) => !conflict.resolved && (!props.tripId || conflict.tripId === props.tripId)),
);

function spotName(id: string) {
  return spotStore.spots.find((spot) => spot.id === id)?.name || id;
}

function fieldLabel(conflict: PendingConflict) {
  const field = conflict.field?.split(':').pop() || '';
  return { budget: '预算金额', start_date: '出发日期', end_date: '返程日期', title: '标题' }[field] || field;
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

async function choose(conflictId: string, bundleId: string) {
  busy.value = true;
  try {
    await sync.resolveConflict(conflictId, bundleId);
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
.conflict-card { border: 1px solid #d96b2b; border-radius: 10px; padding: 10px 12px; margin: 10px 0; background: #fff8f0; }
.candidates { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 8px; }
.candidate { text-align: left; border: 1px solid #d8d8d8; border-radius: 8px; padding: 10px; background: #fff; cursor: pointer; }
.candidate:hover { border-color: #2d7a46; }
.candidate.chosen { border-color: #2d7a46; background: #effaf2; }
</style>
