<template>
  <main class="page" v-if="trip">
    <TripHeader :trip="trip" />
    <div class="toolbar">
      <el-button type="primary" @click="router.push('/spots')">添加景点</el-button>
      <el-button @click="router.push('/planner/' + trip.id + '/1')">编排第 1 天</el-button>
      <el-button @click="router.push('/share')">分享预览</el-button>
      <el-button @click="router.push('/sync')">同步中心</el-button>
      <el-tag :type="sync.online ? 'success' : 'warning'">{{ sync.online ? '在线' : '断网编辑中' }}</el-tag>
      <el-tag v-if="sync.pendingLocalBundles.length" type="info">{{ sync.pendingLocalBundles.length }} 个本地分叉包待合并</el-tag>
    </div>

    <section class="band edit-band">
      <strong>落笔编辑（每次保存生成一个分叉包，记住基准/日期/金额）</strong>
      <div class="toolbar">
        <el-date-picker v-model="draft.start_date" type="date" value-format="YYYY-MM-DD" placeholder="出发日期" size="small" />
        <el-date-picker v-model="draft.end_date" type="date" value-format="YYYY-MM-DD" placeholder="返程日期" size="small" />
        <el-input-number v-model="draft.budget" :min="0" :step="100" size="small" />
        <el-input v-model="draft.title" placeholder="标题" size="small" style="max-width: 180px" />
        <el-button type="primary" size="small" :loading="saving" @click="saveEdits">落笔保存</el-button>
      </div>
    </section>

    <section class="grid">
      <BudgetChart :spent="stats.budget.spent" :remaining="stats.budget.remaining" />
      <div class="band">
        <strong>统计</strong>
        <p>天数 {{ stats.days }} · 景点 {{ stats.spotCount }}</p>
        <p class="muted">{{ stats.budget.warning }}</p>
        <el-button size="small" @click="simulate">模拟家人用车载浏览器分叉编辑</el-button>
      </div>
    </section>

    <ConflictPanel :trip-id="trip.id" :trip-currency="trip.currency" />

    <DayTimeline v-for="day in tripDays" :key="day.id" :day="day" :spots="spotStore.spots" />
  </main>
  <main v-else class="page"><EmptyState title="旅行不存在" /></main>
</template>
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useSyncStore } from '../stores/syncStore';
import { useTripStats } from '../hooks/useTripStats';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import BudgetChart from '../components/common/BudgetChart.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ConflictPanel from '../components/common/ConflictPanel.vue';

const route = useRoute();
const router = useRouter();
const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const sync = useSyncStore();

const trip = computed(() => tripStore.trips.find((item) => item.id === route.params.id));
const tripDays = computed(() => dayPlanStore.dayPlans.filter((day) => day.trip_id === route.params.id));
const tripConflicts = computed(() => sync.conflicts.filter((conflict) => conflict.tripId === route.params.id));
const stats = computed(() =>
  trip.value
    ? useTripStats(
        trip.value,
        dayPlanStore.dayPlans,
        spotStore.spots,
        tripConflicts.value,
      ).value
    : { days: 0, spotCount: 0, budget: { spent: 0, remaining: 0, warning: '' }, conflicts: 0 },
);

const draft = reactive({ title: '', start_date: '', end_date: '', budget: 0 });
const saving = ref(false);
watch(
  trip,
  (value) => {
    if (value) Object.assign(draft, { title: value.title, start_date: value.start_date, end_date: value.end_date, budget: value.budget });
  },
  { immediate: true },
);

async function saveEdits() {
  if (!trip.value) return;
  saving.value = true;
  try {
    const patch: Record<string, unknown> = {};
    if (draft.title !== trip.value.title) patch.title = draft.title;
    if (draft.start_date !== trip.value.start_date) patch.start_date = draft.start_date;
    if (draft.end_date !== trip.value.end_date) patch.end_date = draft.end_date;
    if (draft.budget !== trip.value.budget) patch.budget = draft.budget;
    if (Object.keys(patch).length) await tripStore.editTrip(trip.value.id, patch);
  } finally {
    saving.value = false;
  }
}

async function simulate() {
  if (!trip.value) return;
  await sync.simulateFamilyFork(trip.value.id, trip.value.start_date, trip.value.budget);
  Object.assign(draft, { budget: sync.trips.find((item) => item.id === trip.value!.id)?.budget ?? draft.budget });
}
</script>
