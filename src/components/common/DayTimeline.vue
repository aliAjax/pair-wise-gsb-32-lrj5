<template>
  <section class="band">
    <h3>第 {{ day.day_index }} 天 · {{ day.date || '日期待裁决' }}</h3>
    <ol>
      <li v-for="item in day.items" :key="item.id" :class="{ disputed: disputedIds.has(item.id) }">
        <strong>{{ spotName(item.spot_id) }}</strong>
        <span class="muted">{{ item.start_time }}-{{ item.end_time }} · {{ transportText[item.transport] }} · {{ item.note }}</span>
        <el-tag v-if="disputedIds.has(item.id)" type="danger" size="small">待裁决·不计费</el-tag>
      </li>
    </ol>
    <p v-if="!day.items.length" class="muted">这一天还没有安排。</p>
  </section>
</template>
<script setup lang="ts">
import type { DayPlan } from '../../models/dayPlan';
import type { Spot } from '../../models/spot';
import { transportText } from '../../utils/formatters';
const props = withDefaults(defineProps<{ day: DayPlan; spots: Spot[]; disputedIds?: Set<string> }>(), { disputedIds: () => new Set<string>() });
const spotName = (id: string) => props.spots.find((spot) => spot.id === id)?.name || '未知景点';
</script>
<style scoped>
.disputed { color: #b91c1c; }
.disputed strong { text-decoration: line-through wavy #b91c1c; }
</style>
