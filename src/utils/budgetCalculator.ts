import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { Trip } from '../models/trip';
import type { PendingConflict } from '../models/sync';
import { CONFLICT_REASON } from '../constants/sync';
import { messages } from '../constants/messages';

/** 待裁决的同一时段候选：裁决前不计费用（需求） */
export function excludedItemKeys(conflicts: PendingConflict[]): Set<string> {
  const keys = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.resolved || conflict.reason !== CONFLICT_REASON.SAME_SLOT) continue;
    for (const candidate of conflict.candidates) {
      if (candidate.item) keys.add(`${conflict.tripId}:${conflict.dayIndex}:${candidate.item.spot_id}`);
    }
  }
  return keys;
}

export function calcTripCost(
  dayPlans: DayPlan[],
  spots: Spot[],
  conflicts: PendingConflict[] = [],
) {
  const spotMap = new Map(spots.map((spot) => [spot.id, spot]));
  const excluded = excludedItemKeys(conflicts);
  return dayPlans.reduce((sum, day) => {
    return (
      sum +
      day.items.reduce((inner, item: DayPlanItem) => {
        if (excluded.has(`${day.trip_id}:${day.day_index}:${item.spot_id}`)) return inner;
        return inner + (spotMap.get(item.spot_id)?.price || 0);
      }, 0)
    );
  }, 0);
}

export function budgetStatus(trip: Trip, dayPlans: DayPlan[], spots: Spot[], conflicts: PendingConflict[] = []) {
  const spent = calcTripCost(dayPlans, spots, conflicts);
  const pendingCount = conflicts.filter((conflict) => !conflict.resolved && conflict.reason === CONFLICT_REASON.SAME_SLOT).length;
  const pendingNote = pendingCount > 0 ? `（${pendingCount} 处同一时段待裁决，暂不计费）` : '';
  return {
    spent,
    remaining: trip.budget - spent,
    warning: spent > trip.budget ? messages.budgetExceeded + pendingNote : pendingNote ? messages.pendingExcluded : '',
  };
}
