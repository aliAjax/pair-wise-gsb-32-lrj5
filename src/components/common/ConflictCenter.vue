<template>
  <section class="conflict-center">
    <h2>待家人裁决的冲突</h2>
    <EmptyState v-if="!rows.length" title="没有待裁决冲突" description="同一时段两边改成不同安排时，会在这里保留两份待选。" />
    <article v-for="row in rows" :key="row.conflict.id" class="conflict-card">
      <header>
        <strong>{{ row.conflict.title }}</strong>
        <el-tag size="small" type="danger">{{ slotLabel(row.conflict.slot) }}</el-tag>
        <el-tag v-if="row.tripTitle" size="small" effect="plain">{{ row.tripTitle }}</el-tag>
      </header>
      <div class="choices">
        <el-button type="primary" plain @click="choose(row.conflict.id, 'a')">
          {{ row.conflict.choices[0].label }}
        </el-button>
        <el-button type="primary" plain @click="choose(row.conflict.id, 'b')">
          {{ row.conflict.choices[1].label }}
        </el-button>
        <el-button
          v-if="row.conflict.slot === 'item' && row.conflict.op_a?.kind === 'item-upsert' && row.conflict.op_b?.kind === 'item-upsert'"
          type="warning" plain
          @click="choose(row.conflict.id, 'both')"
        >
          两份都要（第二份顺延 30 分钟）
        </el-button>
      </div>
      <p class="muted">裁决前这处改动不参与费用统计，也不会出现在分享页。</p>
    </article>
    <h2 v-if="resolved.length">裁决历史</h2>
    <article v-for="row in resolved" :key="row.id" class="conflict-card resolved">
      <span>{{ row.title }}</span>
      <el-tag size="small" :type="row.resolved_choice === 'both' ? 'warning' : 'success'">
        {{ row.resolved_choice === 'both' ? '两份都留' : row.resolved_choice === 'a' ? row.choices[0].label : row.choices[1].label }}
      </el-tag>
    </article>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useSyncStore } from '../../stores/syncStore';
import EmptyState from './EmptyState.vue';
import type { ConflictSlotType, PendingConflict } from '../../models/sync';

const sync = useSyncStore();

const rows = computed(() => sync.unresolvedConflicts.map((conflict) => ({
  conflict,
  tripTitle: sync.trips.find((trip) => trip.id === conflict.trip_id)?.title || '',
})));
const resolved = computed(() => sync.allConflicts.filter((conflict): conflict is PendingConflict & { resolved_choice: 'a' | 'b' | 'both' } => Boolean(conflict.resolved_choice)));

function slotLabel(slot: ConflictSlotType) {
  return { trip: '旅行信息', day: '当天日期', item: '同一时段', order: '游玩顺序' }[slot];
}
async function choose(id: string, choice: 'a' | 'b' | 'both') {
  await sync.resolveConflict(id, choice);
}
</script>
<style scoped>
.conflict-center { display: grid; gap: 12px; }
.conflict-card { background: #fff; border: 1px solid #e7c8c8; border-radius: 8px; padding: 14px 16px; display: grid; gap: 10px; }
.conflict-card.resolved { border-color: #cfe0cf; grid-template-columns: 1fr auto; align-items: center; }
.conflict-card header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.choices { display: flex; gap: 10px; flex-wrap: wrap; }
.muted { color: #61706b; margin: 0; font-size: 13px; }
h2 { margin: 8px 0 0; font-size: 17px; }
</style>
