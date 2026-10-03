import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { TripStatus } from '../constants/trip';
import type { Trip } from '../models/trip';
import { tripApi } from '../api/tripApi';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { useSyncStore } from './syncStore';

export const useTripStore = defineStore('trip', () => {
  const sync = useSyncStore();

  const trips = computed<Trip[]>(() => sync.trips as unknown as Trip[]);
  const statusFilter = ref<TripStatus | 'all'>('all');
  const filteredTrips = computed(() =>
    statusFilter.value === 'all' ? trips.value : trips.value.filter((trip) => trip.status === statusFilter.value),
  );

  async function createTrip(title = '杭州周末慢旅行'): Promise<string> {
    const trip: Trip = {
      id: crypto.randomUUID(),
      title,
      destination: '杭州',
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
      budget: 3200,
      currency: 'CNY',
      members: ['我', '朋友'],
      status: TripStatus.PLANNING,
      created_at: new Date().toISOString(),
    };
    // 创建旅行 = 落笔生成出发基准分叉包（锁定，空间紧张时不丢）
    await sync.recordTripCreate(trip as unknown as Record<string, unknown>);
    tripApi.save(sync.trips as unknown as Trip[]);
    toast.ok(messages.tripCreated);
    return trip.id;
  }

  async function removeTrip(id: string) {
    await sync.recordTripRemove(id);
    tripApi.save(sync.trips as unknown as Trip[]);
    toast.ok(messages.tripDeleted);
  }

  /** 编辑旅行信息（日期/金额等）：字段级落笔，断网照存、联网后三路合并 */
  async function editTrip(
    id: string,
    patch: Partial<Pick<Trip, 'title' | 'start_date' | 'end_date' | 'budget' | 'destination' | 'members' | 'status'>>,
  ) {
    await sync.recordTripEdit(id, patch as Record<string, unknown>);
    tripApi.save(sync.trips as unknown as Trip[]);
    toast.ok(messages.tripEdited);
  }

  return { trips, statusFilter, filteredTrips, createTrip, removeTrip, editTrip };
});
