<template>
  <main class="page">
    <h1>我的旅行</h1>
    <el-alert
      v-if="!sync.online"
      type="warning"
      :closable="false"
      show-icon
      title="当前断网：改动照常保存为本地分叉包，网络恢复后自动重联合并"
      class="toolbar"
    />
    <el-alert
      v-else-if="sync.conflicts.length"
      type="error"
      :closable="false"
      show-icon
      :title="`有 ${sync.conflicts.length} 处同游改动待裁决，列表只展示唯一结果`"
      class="toolbar"
    >
      <router-link to="/sync">前往同步中心裁决</router-link>
    </el-alert>
    <div class="toolbar">
      <el-button type="primary" :loading="creating" @click="create">新建旅行</el-button>
      <el-select v-model="tripStore.statusFilter" style="width: 160px">
        <el-option label="全部状态" value="all" />
        <el-option v-for="item in TRIP_STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-button @click="router.push('/sync')">同步中心</el-button>
    </div>
    <EmptyState v-if="!tripStore.filteredTrips.length" title="还没有旅行计划" :description="messages.emptyTrips" />
    <section class="grid">
      <article v-for="trip in tripStore.filteredTrips" :key="trip.id">
        <el-badge :value="pendingCount(trip.id)" type="danger" :hidden="pendingCount(trip.id) === 0">
          <TripCard :trip="trip" @open="open" @remove="tripStore.removeTrip" />
        </el-badge>
      </article>
    </section>
  </main>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import TripCard from '../components/common/TripCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { useTripStore } from '../stores/tripStore';
import { useSyncStore } from '../stores/syncStore';
import { TRIP_STATUS_OPTIONS } from '../constants/trip';
import { messages } from '../constants/messages';
const router = useRouter();
const tripStore = useTripStore();
const sync = useSyncStore();
const creating = ref(false);
function pendingCount(tripId: string) {
  return sync.conflicts.filter((conflict) => conflict.tripId === tripId && !conflict.resolved).length;
}
async function create() {
  creating.value = true;
  try {
    const id = await tripStore.createTrip();
    router.push('/trip/' + id);
  } finally {
    creating.value = false;
  }
}
function open(id: string) { router.push('/trip/' + id); }
</script>
