<template>
  <main class="page">
    <h1>行程编排 · 第 {{ dayIndex }} 天</h1>
    <section class="band">
      <p class="muted">
        拖拽排序、改时段、选交通方式每次保存都生成一个可续作分叉包；
        断网照常编排，联网后与家人的改动自动合并。
      </p>
      <div ref="listEl" class="planner-list">
        <div v-for="item in editableItems" :key="item.data.id" class="planner-row" :data-id="item.data.id">
          <SpotMiniCard :spot="item.spot" />
          <div class="planner-controls">
            <el-time-select v-model="item.data.start_time" start="06:00" step="00:15" end="22:00" placeholder="开始" size="small" />
            <span>-</span>
            <el-time-select v-model="item.data.end_time" start="06:00" step="00:15" end="23:00" placeholder="结束" size="small" />
            <el-select v-model="item.data.transport" size="small" style="width: 96px">
              <el-option v-for="(label, value) in transportText" :key="value" :label="label" :value="value" />
            </el-select>
            <el-input v-model="item.data.note" size="small" style="width: 150px" placeholder="备注" />
            <el-tag v-if="disputed.has(item.data.id)" type="danger" size="small">待裁决</el-tag>
            <el-button size="small" type="primary" @click="saveItem(item.data)">保存</el-button>
            <el-button size="small" @click="remove(item.data.id)">移除</el-button>
          </div>
        </div>
      </div>
      <EmptyState v-if="!editableItems.length" title="这一天还没有安排" description="去景点探索页加入景点。" />
    </section>
    <DayTimeline v-if="day" :day="day" :spots="spotStore.spots" :disputed-ids="disputed" />
    <ConflictCenter />
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Sortable, { type SortableEvent } from 'sortablejs';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useSyncStore } from '../stores/syncStore';
import { disputedItemIds } from '../utils/budgetCalculator';
import { transportText } from '../utils/formatters';
import SpotMiniCard from '../components/common/SpotMiniCard.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ConflictCenter from '../components/common/ConflictCenter.vue';
import type { DayPlanItem } from '../models/dayPlan';
import type { Spot } from '../models/spot';

const route = useRoute();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const sync = useSyncStore();
const listEl = ref<HTMLElement>();
const tripId = String(route.params.tripId);
const dayIndex = Number(route.params.dayIndex || 1);

const day = computed(() => dayPlanStore.findDay(tripId, dayIndex));
const spotOf = (id: string): Spot => spotStore.spots.find((spot) => spot.id === id) || {
  id, name: '未知景点', category: 'nature', address: '', lat: 0, lng: 0, rating: 0, price: 0, open_time: '', tags: [], image: '',
} as Spot;

// 行内可编辑副本（不直接改投影，点保存才生成包）
const editableItems = ref<{ data: DayPlanItem; spot: Spot }[]>([]);
function refreshEditable() {
  editableItems.value = (day.value?.items || []).map((item) => ({ data: JSON.parse(JSON.stringify(item)), spot: spotOf(item.spot_id) }));
}
const disputed = computed(() => disputedItemIds(sync.allConflicts, tripId));

function saveItem(item: DayPlanItem) {
  if (day.value) dayPlanStore.upsertItem(tripId, day.value.id, item, `改时段/交通：${item.start_time}-${item.end_time}`);
  refreshEditable();
}
function remove(itemId: string) {
  if (day.value) dayPlanStore.removeItem(tripId, day.value.id, itemId);
  refreshEditable();
}

onMounted(() => {
  refreshEditable();
  if (listEl.value) {
    new Sortable(listEl.value, {
      animation: 150,
      onEnd: (evt: SortableEvent) => {
        const next = Array.from(evt.from.children)
          .map((node) => (node as HTMLElement).dataset.id)
          .filter(Boolean) as string[];
        if (day.value && next.length) dayPlanStore.reorder(tripId, day.value.id, next);
      },
    });
  }
});

// 分叉包合并 / 裁决后投影会变，编辑副本要对齐最新的"唯一一份结果"
watch(day, () => refreshEditable(), { deep: true });
</script>
<style scoped>
.planner-list { display: grid; gap: 8px; margin: 12px 0; }
.planner-row { background: #fff; border: 1px solid #dbe7cf; border-radius: 8px; padding: 10px 12px; cursor: grab; }
.planner-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
</style>
