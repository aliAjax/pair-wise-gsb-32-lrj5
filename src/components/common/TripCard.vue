<template>
  <article class="trip-card">
    <div>
      <strong>{{ trip.title }}</strong>
      <p class="muted">{{ trip.destination }} · {{ formatDate(trip.start_date) }} - {{ formatDate(trip.end_date) }}</p>
    </div>
    <div class="tags">
      <el-tag>{{ tripStatusText[trip.status] }}</el-tag>
      <el-tag v-if="openConflicts" type="danger">{{ openConflicts }} 待裁决</el-tag>
    </div>
    <p>预算 {{ formatCurrency(trip.budget, trip.currency) }} · 同行 {{ trip.members.join('、') }}</p>
    <div class="toolbar">
      <el-button type="primary" @click="$emit('open', trip.id)">进入详情</el-button>
      <el-button @click="$emit('remove', trip.id)">删除</el-button>
    </div>
  </article>
</template>
<script setup lang="ts">
import type { Trip } from '../../models/trip';
import { formatCurrency, formatDate, tripStatusText } from '../../utils/formatters';
withDefaults(defineProps<{ trip: Trip; openConflicts?: number }>(), { openConflicts: 0 });
defineEmits<{ open: [id: string]; remove: [id: string] }>();
</script>
<style scoped>
.trip-card { background: #fff; border: 1px solid #dbe7cf; border-radius: 8px; padding: 18px; }
.tags { display: flex; gap: 8px; margin: 8px 0; }
</style>
