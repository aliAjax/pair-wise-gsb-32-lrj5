// 分叉包操作的重放：把一串 BundleOp 应用到 World 上得到投影结果
// 列表 / 当天路线 / 分享页都只认这一份投影，杜绝"后保存盖掉先保存"

import type { Trip } from '../models/trip';
import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import type { BundleOp, BundleTripFields } from '../models/sync';

export interface World {
  trips: Record<string, Trip>;
  days: Record<string, DayPlan>;
}

export function emptyWorld(): World {
  return { trips: {}, days: {} };
}

export function cloneWorld(world: World): World {
  return JSON.parse(JSON.stringify(world)) as World;
}

export function worldFromLists(trips: Trip[], dayPlans: DayPlan[]): World {
  const world = emptyWorld();
  trips.forEach((trip) => { world.trips[trip.id] = JSON.parse(JSON.stringify(trip)); });
  dayPlans.forEach((day) => { world.days[day.id] = JSON.parse(JSON.stringify(day)); });
  return world;
}

export function worldTrips(world: World): Trip[] {
  return Object.values(world.trips).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export function worldDays(world: World, tripId?: string): DayPlan[] {
  return Object.values(world.days)
    .filter((day) => !tripId || day.trip_id === tripId)
    .sort((a, b) => a.day_index - b.day_index || a.date.localeCompare(b.date));
}

export function tripSnapshotFields(trip: Trip) {
  return {
    start_date: trip.start_date,
    end_date: trip.end_date,
    budget: trip.budget,
    currency: trip.currency,
  };
}

const TRIP_FIELDS: (keyof BundleTripFields)[] = [
  'title', 'destination', 'start_date', 'end_date', 'budget', 'currency', 'members', 'status',
];

function applyTripUpsert(world: World, tripId: string, fields: Partial<BundleTripFields>) {
  const existing = world.trips[tripId];
  if (existing) {
    Object.assign(existing, fields);
    return;
  }
  // 离线新建的旅行在基准缺失时也要能独立重放
  world.trips[tripId] = {
    id: tripId,
    title: fields.title || '未命名旅行',
    destination: fields.destination || '',
    start_date: fields.start_date || '',
    end_date: fields.end_date || '',
    budget: fields.budget ?? 0,
    currency: fields.currency || 'CNY',
    members: fields.members || [],
    status: fields.status || 'planning',
    created_at: new Date().toISOString(),
  } as Trip;
}

function applyItemUpsert(world: World, tripId: string, dayId: string, item: DayPlanItem) {
  let day = world.days[dayId];
  if (!day) {
    day = { id: dayId, trip_id: tripId, day_index: 1, date: '', items: [] };
    world.days[dayId] = day;
  }
  const index = day.items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) day.items[index] = { ...day.items[index], ...item };
  else day.items.push({ ...item });
}

function applyOrder(world: World, dayId: string, itemIds: string[]) {
  const day = world.days[dayId];
  if (!day) return;
  const byId = new Map(day.items.map((item) => [item.id, item]));
  const ordered: DayPlanItem[] = [];
  itemIds.forEach((id) => {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  });
  // 新增但不在顺序包里的条目挂到末尾
  byId.forEach((item) => ordered.push(item));
  day.items = ordered;
}

export function applyOps(source: World, ops: BundleOp[]): World {
  const world = cloneWorld(source);
  ops.forEach((op) => {
    switch (op.kind) {
      case 'trip-upsert':
        applyTripUpsert(world, op.tripId, op.fields);
        break;
      case 'trip-remove':
        delete world.trips[op.tripId];
        Object.keys(world.days).forEach((dayId) => {
          if (world.days[dayId].trip_id === op.tripId) delete world.days[dayId];
        });
        break;
      case 'day-upsert': {
        const existing = world.days[op.dayId];
        if (existing) Object.assign(existing, op.fields);
        else world.days[op.dayId] = { id: op.dayId, trip_id: op.tripId, day_index: op.dayIndex, date: op.fields.date || '', items: [] };
        break;
      }
      case 'day-remove':
        delete world.days[op.dayId];
        break;
      case 'item-upsert':
        applyItemUpsert(world, op.tripId, op.dayId, op.item);
        break;
      case 'item-remove': {
        const day = world.days[op.dayId];
        if (day) day.items = day.items.filter((item) => item.id !== op.itemId);
        break;
      }
      case 'order':
        applyOrder(world, op.dayId, op.itemIds);
        break;
    }
  });
  return world;
}

export { TRIP_FIELDS };
