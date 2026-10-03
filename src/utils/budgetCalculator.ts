import type { DayPlan } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { Trip } from '../models/trip';
import type { PendingConflict } from '../models/sync';
import { messages } from '../constants/messages';

// 裁决前不计费用：凡出现在未裁决冲突里的条目（同时段两份 / 同条目两份 / 删除 vs 修改）
// 一律不计入预算，等家人拍板后再结算。
export function disputedItemIds(conflicts: PendingConflict[], tripId: string): Set<string> {
  const ids = new Set<string>();
  conflicts.forEach((conflict) => {
    if (conflict.resolved_choice || conflict.trip_id !== tripId) return;
    [conflict.op_a, conflict.op_b].forEach((op) => {
      if (op && op.kind === 'item-upsert') ids.add(op.item.id);
    });
    if (conflict.slot === 'item' && conflict.slot_key.includes(':existence:')) {
      const itemId = conflict.slot_key.split(':item:')[1]?.split(':')[0];
      if (itemId) ids.add(itemId);
    }
  });
  return ids;
}

export function tripHasOpenConflict(conflicts: PendingConflict[], tripId: string) {
  return conflicts.some((conflict) => !conflict.resolved_choice && conflict.trip_id === tripId);
}

export function calcTripCost(dayPlans: DayPlan[], spots: Spot[], disputed: Set<string> = new Set()) {
  const spotMap = new Map(spots.map((spot) => [spot.id, spot]));
  return dayPlans.reduce((sum, day) => {
    return sum + day.items.reduce((inner, item) => {
      if (disputed.has(item.id)) return inner; // 待裁决安排不计费用
      return inner + (spotMap.get(item.spot_id)?.price || 0);
    }, 0);
  }, 0);
}

export function budgetStatus(
  trip: Trip,
  dayPlans: DayPlan[],
  spots: Spot[],
  conflicts: PendingConflict[] = [],
) {
  const open = tripHasOpenConflict(conflicts, trip.id);
  const disputed = disputedItemIds(conflicts, trip.id);
  const spent = calcTripCost(dayPlans, spots, disputed);
  const warning = open
    ? messages.conflictGateBudget
    : spent > trip.budget
      ? messages.budgetExceeded
      : '';
  return { spent, remaining: trip.budget - spent, warning, gated: open };
}
