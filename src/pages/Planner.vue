<template>
  <main class="page">
    <h1>行程编排 · 第 {{ dayIndex }} 天</h1>
    <section class="band">
      <p class="muted">拖拽排序或修改时段均会立即落笔为分叉包；断网照常编辑，联网后按同一时段合并。</p>
      <el-tag :type="sync.online ? 'success' : 'warning'">{{ sync.online ? '在线' : '断网编辑中' }}</el-tag>
      <div ref="listEl" class="planner-list">
        <div v-for="(spot, index) in daySpots" :key="spot.id + index" class="planner-row">
          <SpotMiniCard :spot="spot" />
          <el-time-select
            v-model="times[index].start"
            start="06:00" step="00:30" end="23:00"
            size="small" placeholder="开始"
            @change="commitTime(index)"
          />
          <el-time-select
            v-model="times[index].end"
            start="06:00" step="00:30" end="23:30"
            size="small" placeholder="结束"
            @change="commitTime(index)"
          />
        </div>
      </div>
    </section>
    <ConflictPanel :trip-id="tripId" />
    <DayTimeline v-if="day" :day="day" :spots="spotStore.spots" />
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Sortable, { type SortableEvent } from 'sortablejs';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useSyncStore } from '../stores/syncStore';
import SpotMiniCard from '../components/common/SpotMiniCard.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import ConflictPanel from '../components/common/ConflictPanel.vue';
import type { DayPlanItem } from '../models/dayPlan';

const route = useRoute();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const sync = useSyncStore();
const listEl = ref<HTMLElement>();
const tripId = String(route.params.tripId);
const dayIndex = Number(route.params.dayIndex || 1);
const day = computed(() => dayPlanStore.ensureDay(tripId, dayIndex));
const daySpots = computed(() =>
  day.value.items
    .map((item) => spotStore.spots.find((spot) => spot.id === item.spot_id))
    .filter(Boolean) as any[],
);
const times = ref<{ start: string; end: string }[]>([]);
watch(
  () => day.value.items.map((item) => item.spot_id).join(','),
  () => {
    times.value = day.value.items.map((item) => ({ start: item.start_time, end: item.end_time }));
  },
  { immediate: true },
);

onMounted(() => {
  if (listEl.value) {
    new Sortable(listEl.value, {
      animation: 150,
      onEnd: (evt: SortableEvent) => dayPlanStore.reorder(tripId, dayIndex, evt.oldIndex || 0, evt.newIndex || 0),
    });
  }
});

async function commitTime(index: number) {
  const item = day.value.items[index] as DayPlanItem | undefined;
  const slot = times.value[index];
  if (!item || !slot?.start || !slot?.end) return;
  const price = spotStore.spots.find((spot) => spot.id === item.spot_id)?.price || 0;
  await dayPlanStore.updateItem(tripId, dayIndex, day.value.date, { ...item, start_time: slot.start, end_time: slot.end }, price);
}
</script>
<style scoped>
.planner-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.planner-row { display: flex; align-items: center; gap: 10px; }
</style>
