<template>
  <main class="page">
    <template v-if="trip">
      <TripHeader :trip="trip" />
      <el-alert
        v-if="gated"
        type="warning"
        show-icon
        :closable="false"
        :title="messages.conflictGateShare"
        description="同一时段还有两份待选，家人拍板前列表、当天路线与分享页保持一致，不提前结算费用或分享。"
        class="gate"
      />
      <template v-else>
        <div class="toolbar">
          <el-button type="primary" @click="copyText">复制行程文本</el-button>
          <el-tag type="success">所有分叉已对齐到同一份结果</el-tag>
        </div>
        <section class="grid share-budget">
          <div class="band">
            <strong>费用决算</strong>
            <p>已确定花费 {{ formatCurrency(stats.budget.spent, trip.currency) }} / 预算 {{ formatCurrency(trip.budget, trip.currency) }}</p>
          </div>
        </section>
        <DayTimeline v-for="day in tripDays" :key="day.id" :day="day" :spots="spotStore.spots" :disputed-ids="new Set()" />
      </template>
    </template>
    <EmptyState v-else title="没有可分享的旅行" description="请从旅行详情页进入分享预览。" />
  </main>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useSyncStore } from '../stores/syncStore';
import { useTripStats } from '../hooks/useTripStats';
import { tripHasOpenConflict } from '../utils/budgetCalculator';
import { formatCurrency } from '../utils/formatters';
import { messages } from '../constants/messages';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import EmptyState from '../components/common/EmptyState.vue';

const route = useRoute();
const tripStore = useTripStore();
const spotStore = useSpotStore();
const sync = useSyncStore();

const trip = computed(() => tripStore.byId(String(route.query.trip || '')) || sync.trips[0]);
const tripDays = computed(() => (trip.value ? sync.dayPlansOf(trip.value.id) : []));
const stats = useTripStats(trip, tripDays, computed(() => spotStore.spots), computed(() => sync.allConflicts));
const gated = computed(() => Boolean(trip.value && tripHasOpenConflict(sync.allConflicts, trip.value.id)));

function copyText() {
  if (!trip.value || gated.value) return;
  const lines = [
    `TripWeaver 行程单：${trip.value.title}`,
    `${trip.value.destination} ${trip.value.start_date} 至 ${trip.value.end_date}`,
    ...tripDays.value.flatMap((day) => [
      `第 ${day.day_index} 天 ${day.date}`,
      ...day.items.map((item) => {
        const spot = spotStore.spots.find((candidate) => candidate.id === item.spot_id);
        return `  ${item.start_time}-${item.end_time} ${spot?.name || item.spot_id}`;
      }),
    ]),
    `费用决算 ${formatCurrency(stats.value.budget.spent, trip.value.currency)}`,
  ];
  navigator.clipboard?.writeText(lines.join('\n'));
}
</script>
<style scoped>
.gate { margin: 16px 0; }
.share-budget { margin-bottom: 16px; }
</style>
