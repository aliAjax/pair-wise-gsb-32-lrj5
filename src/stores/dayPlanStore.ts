import { defineStore } from 'pinia';
import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import type { BundleOp } from '../models/sync';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { useSyncStore } from './syncStore';

// DayPlan 实体 store：读取唯一一份投影结果（在线=云端裁决，断网=本机分叉）；
// 每次落笔都生成 item/day/order 分叉包，记住所属旅行基准。
export const useDayPlanStore = defineStore('dayPlan', {
  state: () => ({
    // 新建旅行后还没安排时，编辑器需要的"草稿日索引"
    draftDayIndex: 1,
  }),
  getters: {
    dayPlans(): DayPlan[] {
      return useSyncStore().dayPlans;
    },
  },
  actions: {
    daysOf(tripId: string): DayPlan[] {
      return useSyncStore().dayPlansOf(tripId);
    },
    findDay(tripId: string, dayIndex: number): DayPlan | undefined {
      return this.daysOf(tripId).find((day) => day.day_index === dayIndex);
    },
    // 下一个可用时段：默认 10:00 起，按当天已有条目末尾顺延
    nextSlot(day: DayPlan | undefined) {
      if (!day || !day.items.length) return { start_time: '10:00', end_time: '12:00' };
      const last = [...day.items].sort((a, b) => b.end_time.localeCompare(a.end_time))[0];
      const [hour, minute] = last.end_time.split(':').map(Number);
      const total = hour * 60 + minute;
      const fmt = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
      return { start_time: last.end_time, end_time: fmt(Math.min(total + 120, 23 * 60)) };
    },
    addSpot(tripId: string, spotId: string, dayIndex = 1) {
      const sync = useSyncStore();
      const existing = this.findDay(tripId, dayIndex);
      const trip = sync.trips.find((item) => item.id === tripId);
      const date = existing?.date || trip?.start_date || new Date().toISOString().slice(0, 10);
      const dayId = existing?.id || crypto.randomUUID();
      const slot = this.nextSlot(existing);
      const item: DayPlanItem = {
        id: crypto.randomUUID(),
        spot_id: spotId,
        start_time: slot.start_time,
        end_time: slot.end_time,
        note: '现场调整',
        transport: 'metro',
      };
      const ops: BundleOp[] = [];
      if (!existing) ops.push({ kind: 'day-upsert', tripId, dayId, dayIndex, fields: { date } });
      ops.push({ kind: 'item-upsert', tripId, dayId, item });
      sync.appendEdit(ops, `第 ${dayIndex} 天加入景点`, tripId, trip);
      toast.ok(messages.spotAdded);
    },
    upsertItem(tripId: string, dayId: string, item: DayPlanItem, note = '调整当天安排') {
      const sync = useSyncStore();
      const trip = sync.trips.find((candidate) => candidate.id === tripId);
      const day = this.daysOf(tripId).find((candidate) => candidate.id === dayId);
      const ops: BundleOp[] = [];
      if (!day) ops.push({ kind: 'day-upsert', tripId, dayId, dayIndex: this.draftDayIndex, fields: { date: trip?.start_date || '' } });
      ops.push({ kind: 'item-upsert', tripId, dayId, item });
      sync.appendEdit(ops, note, tripId, trip);
      toast.ok(messages.itemUpdated);
    },
    removeItem(tripId: string, dayId: string, itemId: string) {
      const sync = useSyncStore();
      const trip = sync.trips.find((candidate) => candidate.id === tripId);
      sync.appendEdit([{ kind: 'item-remove', tripId, dayId, itemId }], '移除一项安排', tripId, trip);
      toast.ok(messages.itemRemoved);
    },
    reorder(tripId: string, dayId: string, itemIds: string[]) {
      const sync = useSyncStore();
      const trip = sync.trips.find((candidate) => candidate.id === tripId);
      sync.appendEdit([{ kind: 'order', tripId, dayId, itemIds }], '拖拽调整当天顺序', tripId, trip);
      toast.ok(messages.reordered);
    },
  },
});
