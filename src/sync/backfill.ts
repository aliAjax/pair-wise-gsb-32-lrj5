// 旧数据回填：v1（或更早、缺版本号）的 trips/dayPlans 先升级为 v2 分叉包基准。
// 触发时机：每台设备首次接入同步层且尚未标记回填。旧数据不删除，只读出并灌入基准。

import { STORAGE_KEYS } from '../constants/storageVersion';
import { isLegacyPayload, loadRaw } from '../utils/storage';
import type { Trip } from '../models/trip';
import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import { worldFromLists, type World } from './world';

interface LegacyBundles {
  trips: Trip[];
  dayPlans: DayPlan[];
  hadLegacy: boolean;
}

function upgradeItem(raw: Record<string, unknown>, dayId: string, index: number): DayPlanItem {
  return {
    // v1 条目没有 id：用 dayId+位置 派生稳定 id
    id: String(raw.id || `${dayId}-item-${index}`),
    spot_id: String(raw.spot_id || ''),
    start_time: String(raw.start_time || '10:00'),
    end_time: String(raw.end_time || '12:00'),
    note: String(raw.note || ''),
    transport: (raw.transport as DayPlanItem['transport']) || 'metro',
  };
}

export function readLegacyData(): LegacyBundles {
  const tripPayload = loadRaw<Trip[]>(STORAGE_KEYS.legacyTrips);
  const dayPayload = loadRaw<DayPlan[]>(STORAGE_KEYS.legacyDayPlans);
  const hadLegacy = Boolean(
    (tripPayload && isLegacyPayload(tripPayload.version)) ||
    (dayPayload && isLegacyPayload(dayPayload.version)),
  );

  const trips = (tripPayload?.data || []).map((raw) => ({ ...raw }));
  const dayPlans = (dayPayload?.data || []).map((rawDay) => ({
    id: String(rawDay.id || crypto.randomUUID()),
    trip_id: String(rawDay.trip_id),
    day_index: Number(rawDay.day_index || 1),
    date: String(rawDay.date || ''),
    items: (Array.isArray(rawDay.items) ? rawDay.items : []).map((rawItem, index) =>
      upgradeItem(rawItem as unknown as Record<string, unknown>, String(rawDay.id), index)),
  }));

  return { trips, dayPlans, hadLegacy };
}

// 让种子数据 / v2 数据也保证条目有稳定 id（老用户可能存过 v2 早期无 id 条目）
export function ensureItemIds(dayPlans: DayPlan[]): DayPlan[] {
  return dayPlans.map((day) => ({
    ...day,
    items: day.items.map((item, index) => ({ ...item, id: item.id || `${day.id}-item-${index}` })),
  }));
}

export function legacyWorld(): World {
  const { trips, dayPlans } = readLegacyData();
  return worldFromLists(trips, ensureItemIds(dayPlans));
}
