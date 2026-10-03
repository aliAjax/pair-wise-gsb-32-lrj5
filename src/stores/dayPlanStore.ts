import { defineStore } from 'pinia';
import { computed } from 'vue';
import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import { dayPlanApi } from '../api/dayPlanApi';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { useSyncStore } from './syncStore';
import type { ItemPatch } from '../models/sync';

export const useDayPlanStore = defineStore('dayPlan', () => {
  const sync = useSyncStore();

  /** 当天路线读重联后的唯一结果（含本机未同步草稿投影，不含争议条目） */
  const dayPlans = computed<DayPlan[]>(() => sync.dayPlans as unknown as DayPlan[]);

  function ensureDay(tripId: string, dayIndex = 1, date = new Date().toISOString().slice(0, 10)): DayPlan {
    const existing = dayPlans.value.find((item) => item.trip_id === tripId && item.day_index === dayIndex);
    if (existing) return existing;
    return { id: dayPlanApi.dayId(tripId, dayIndex), trip_id: tripId, day_index: dayIndex, date, items: [] };
  }

  async function addSpot(tripId: string, spotId: string, dayIndex = 1, price = 0) {
    const date = new Date().toISOString().slice(0, 10);
    const item: DayPlanItem = { spot_id: spotId, start_time: '10:00', end_time: '12:00', note: '现场调整', transport: 'metro' };
    // 每次添加都是一次落笔：存成可续作分叉包，记住日期与金额
    await sync.recordDayItem(tripId, dayIndex, date, item as ItemPatch, price, false);
    dayPlanApi.save(sync.dayPlans as unknown as DayPlan[]);
    toast.ok(messages.spotAdded);
  }

  async function removeSpot(tripId: string, dayIndex: number, spotId: string, date: string) {
    await sync.recordDayItem(
      tripId,
      dayIndex,
      date,
      { spot_id: spotId, start_time: '10:00', end_time: '12:00' },
      0,
      true,
    );
    dayPlanApi.save(sync.dayPlans as unknown as DayPlan[]);
  }

  async function updateItem(tripId: string, dayIndex: number, date: string, item: DayPlanItem, price: number) {
    await sync.recordDayItem(tripId, dayIndex, date, item as ItemPatch, price, false);
    dayPlanApi.save(sync.dayPlans as unknown as DayPlan[]);
  }

  async function reorder(tripId: string, dayIndex: number, _from: number, to: number) {
    const day = ensureDay(tripId, dayIndex);
    const items = [...day.items];
    if (to < 0 || to >= items.length) return;
    const moved = items[_from];
    if (!moved) return;
    items.splice(_from, 1);
    items.splice(to, 0, moved);
    await sync.recordReorder(tripId, dayIndex, day.date, items as ItemPatch[]);
    dayPlanApi.save(sync.dayPlans as unknown as DayPlan[]);
  }

  return { dayPlans, ensureDay, addSpot, removeSpot, updateItem, reorder };
});
