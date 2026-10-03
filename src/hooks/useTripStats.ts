import { computed, type ComputedRef } from 'vue';
import type { Trip } from '../models/trip';
import type { DayPlan } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { PendingConflict } from '../models/sync';
import { budgetStatus, disputedItemIds } from '../utils/budgetCalculator';

export interface TripStats {
  days: number;
  spotCount: number;
  budget: ReturnType<typeof budgetStatus>;
  openConflicts: number;
}

export function useTripStats(
  trip: ComputedRef<Trip | undefined>,
  dayPlans: ComputedRef<DayPlan[]> | (() => DayPlan[]),
  spots: ComputedRef<Spot[]> | Spot[],
  conflicts: ComputedRef<PendingConflict[]> | PendingConflict[] = [],
) {
  return computed<TripStats>(() => {
    const current = trip.value;
    const plans = typeof dayPlans === 'function' ? dayPlans() : dayPlans.value;
    const spotList = Array.isArray(spots) ? spots : spots.value;
    const pendingConflicts = Array.isArray(conflicts) ? conflicts : conflicts.value;
    if (!current) {
      return {
        days: 0, spotCount: 0,
        budget: { spent: 0, remaining: 0, warning: '', gated: false },
        openConflicts: 0,
      };
    }
    const tripDays = plans.filter((day) => day.trip_id === current.id);
    const disputed = disputedItemIds(pendingConflicts, current.id);
    const openConflicts = pendingConflicts.filter((item) => !item.resolved_choice && item.trip_id === current.id);
    return {
      days: Math.max(1, tripDays.length),
      spotCount: tripDays.reduce(
        (sum, day) => sum + day.items.filter((item) => !disputed.has(item.id)).length,
        0,
      ),
      budget: budgetStatus(current, tripDays, spotList, pendingConflicts),
      openConflicts: openConflicts.length,
    };
  });
}
