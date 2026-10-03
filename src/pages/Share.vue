<template>
  <main class="page">
    <template v-if="trip">
      <TripHeader :trip="trip" />
      <el-alert
        v-if="pendingCount"
        type="warning"
        :closable="false"
        show-icon
        :title="`有 ${pendingCount} 处同一时段安排待裁决，争议内容不会出现在本分享页；裁决后这里自动更新`"
        class="toolbar"
      />
      <p class="band">
        预算（仅含已确定安排）：<strong>{{ formatCurrency(stats.budget.spent, trip.currency) }}</strong>
        / {{ formatCurrency(trip.budget, trip.currency) }}
      </p>
      <DayTimeline v-for="day in tripDays" :key="day.id" :day="day" :spots="spotStore.spots" />
      <div class="toolbar">
        <el-button type="primary" @click="copyText">复制行程文本</el-button>
      </div>
    </template>
    <EmptyState v-else title="暂无可分享的旅行" description="先在“我的旅行”里创建一次出游。" />
  </main>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useSyncStore } from '../stores/syncStore';
import { useTripStats } from '../hooks/useTripStats';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { formatCurrency } from '../utils/formatters';
const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const sync = useSyncStore();
const trip = computed(() => tripStore.trips[0]);
const tripDays = computed(() => dayPlanStore.dayPlans.filter((day) => day.trip_id === trip.value?.id));
const pendingCount = computed(() => sync.conflicts.filter((conflict) => conflict.tripId === trip.value?.id).length);
const stats = computed(() =>
  trip.value
    ? useTripStats(trip.value, dayPlanStore.dayPlans, spotStore.spots, sync.conflicts).value
    : { budget: { spent: 0 } },
);
function copyText() {
  if (!trip.value) return;
  const lines = [`TripWeaver 行程单：${trip.value.title}`, `${trip.value.destination} · ${trip.value.start_date} 至 ${trip.value.end_date}`];
  for (const day of tripDays.value) {
    lines.push(`第 ${day.day_index} 天（${day.date}）`);
    for (const item of day.items) {
      const name = spotStore.spots.find((spot) => spot.id === item.spot_id)?.name || item.spot_id;
      lines.push(`  ${item.start_time}-${item.end_time} ${name}`);
    }
  }
  navigator.clipboard?.writeText(lines.join('\n'));
}
</script>
