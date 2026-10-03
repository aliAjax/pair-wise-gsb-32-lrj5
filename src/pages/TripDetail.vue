<template>
  <main class="page" v-if="trip">
    <TripHeader :trip="trip" />
    <div class="toolbar">
      <el-button type="primary" @click="router.push('/spots')">添加景点</el-button>
      <el-button @click="router.push('/planner/' + trip.id + '/1')">编排第 1 天</el-button>
      <el-button @click="router.push('/share?trip=' + trip.id)">分享预览</el-button>
      <el-button @click="editing = true">改日期/金额</el-button>
      <el-tag v-if="stats.openConflicts" type="danger">有 {{ stats.openConflicts }} 处待裁决</el-tag>
      <el-tag v-else-if="!sync.online" type="warning">离线编辑中 · {{ sync.pendingCount }} 个分叉包</el-tag>
    </div>
    <section class="grid">
      <BudgetChart :spent="stats.budget.spent" :remaining="stats.budget.remaining" :gated="stats.budget.gated" />
      <div class="band">
        <strong>统计（唯一一份裁决结果）</strong>
        <p>天数 {{ stats.days }} · 有效景点 {{ stats.spotCount }}</p>
        <p class="muted" :class="{ warn: stats.budget.gated }">{{ stats.budget.warning || '所有改动已对齐，无待裁决项。' }}</p>
      </div>
    </section>
    <DayTimeline
      v-for="day in tripDays"
      :key="day.id"
      :day="day"
      :spots="spotStore.spots"
      :disputed-ids="disputed"
    />
    <ConflictCenter />
    <TripEditDialog v-model="editing" :trip="trip" @save="onSave" />
  </main>
  <main v-else class="page"><EmptyState title="旅行不存在" /></main>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useSyncStore } from '../stores/syncStore';
import { useTripStats } from '../hooks/useTripStats';
import { disputedItemIds } from '../utils/budgetCalculator';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import BudgetChart from '../components/common/BudgetChart.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ConflictCenter from '../components/common/ConflictCenter.vue';
import TripEditDialog from '../components/common/TripEditDialog.vue';
import type { Trip } from '../models/trip';

const route = useRoute();
const router = useRouter();
const tripStore = useTripStore();
const spotStore = useSpotStore();
const sync = useSyncStore();
const editing = ref(false);

const trip = computed(() => tripStore.byId(String(route.params.id)));
const tripDays = computed(() => sync.dayPlansOf(String(route.params.id)));
const stats = useTripStats(trip, tripDays, computed(() => spotStore.spots), computed(() => sync.allConflicts));
const disputed = computed(() => disputedItemIds(sync.allConflicts, String(route.params.id)));

function onSave(fields: Partial<Trip>) {
  if (trip.value) tripStore.updateTrip(trip.value.id, fields);
}
</script>
<style scoped>
.warn { color: #b45309; font-weight: 600; }
</style>
