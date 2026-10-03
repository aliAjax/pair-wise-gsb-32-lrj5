import type { DayPlan } from '../models/dayPlan';
import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, saveLocal } from '../utils/storage';
import { dayIdOf } from '../utils/sync/ids';

export const dayPlanApi = {
  list: () => loadLocal<DayPlan[]>(STORAGE_KEYS.dayPlans, []).data,
  save: (items: DayPlan[]) => saveLocal(STORAGE_KEYS.dayPlans, items),
  /** 同一天的 id 必须在两台设备上一致，三路合并才能对上同一时段 */
  dayId: (tripId: string, dayIndex: number) => dayIdOf(tripId, dayIndex),
};
