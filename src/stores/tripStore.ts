import { defineStore } from 'pinia';
import { computed } from 'vue';
import { TripStatus } from '../constants/trip';
import type { Trip } from '../models/trip';
import type { BundleOp } from '../models/sync';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { useSyncStore } from './syncStore';

// Trip 实体 store：本身不再落盘。每次创建/修改都写成可续作分叉包，
// 由 syncStore 负责断网缓存、联网合并与裁决结果投影。
export const useTripStore = defineStore('trip', {
  state: () => ({ statusFilter: 'all' as TripStatus | 'all' }),
  getters: {
    trips(): Trip[] {
      return useSyncStore().trips;
    },
    filteredTrips(): Trip[] {
      return this.statusFilter === 'all' ? this.trips : this.trips.filter((trip) => trip.status === this.statusFilter);
    },
  },
  actions: {
    byId(id: string): Trip | undefined {
      return useSyncStore().trips.find((trip) => trip.id === id);
    },
    createTrip(title = '杭州周末慢旅行') {
      const id = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
      const trip: Trip = {
        id,
        title,
        destination: '杭州',
        start_date: today,
        end_date: end,
        budget: 3200,
        currency: 'CNY',
        members: ['我', '家人'],
        status: TripStatus.PLANNING,
        created_at: new Date().toISOString(),
      };
      const op: BundleOp = { kind: 'trip-upsert', tripId: id, fields: {
        title: trip.title, destination: trip.destination, start_date: trip.start_date,
        end_date: trip.end_date, budget: trip.budget, currency: trip.currency,
        members: trip.members, status: trip.status,
      } };
      useSyncStore().appendEdit([op], `新建旅行《${title}》`, id, trip);
      toast.ok(messages.tripCreated);
      return id;
    },
    updateTrip(id: string, fields: Partial<Trip>) {
      const current = this.byId(id);
      if (!current) return;
      const next = { ...current, ...fields };
      const op: BundleOp = { kind: 'trip-upsert', tripId: id, fields: {
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.destination !== undefined ? { destination: fields.destination } : {}),
        ...(fields.start_date !== undefined ? { start_date: fields.start_date } : {}),
        ...(fields.end_date !== undefined ? { end_date: fields.end_date } : {}),
        ...(fields.budget !== undefined ? { budget: fields.budget } : {}),
        ...(fields.currency !== undefined ? { currency: fields.currency } : {}),
        ...(fields.members !== undefined ? { members: fields.members } : {}),
        ...(fields.status !== undefined ? { status: fields.status } : {}),
      } };
      useSyncStore().appendEdit([op], `修改旅行信息（日期/金额等）`, id, next);
      toast.ok(messages.tripUpdated);
    },
    removeTrip(id: string) {
      const op: BundleOp = { kind: 'trip-remove', tripId: id };
      useSyncStore().appendEdit([op], '删除整趟旅行', id);
      toast.ok(messages.tripDeleted);
    },
  },
});

// 给组件里的 computed(() => store.xxx) 使用时保持响应式的辅助
export function useTripList() {
  const sync = useSyncStore();
  return computed(() => sync.trips);
}
