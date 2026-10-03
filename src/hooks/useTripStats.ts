import { computed } from 'vue';
import type { Trip } from '../models/trip';
import type { DayPlan } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { PendingConflict } from '../models/sync';
import { budgetStatus } from '../utils/budgetCalculator';

export function useTripStats(trip: Trip, dayPlans: DayPlan[], spots: Spot[], conflicts: PendingConflict[] = []) {
  return computed(() => ({
    days: Math.max(1, dayPlans.filter((day) => day.trip_id === trip.id).length),
    spotCount: dayPlans.filter((day) => day.trip_id === trip.id).reduce((sum, day) => sum + day.items.length, 0),
    budget: budgetStatus(trip, dayPlans.filter((day) => day.trip_id === trip.id), spots, conflicts),
    conflicts: conflicts.filter((conflict) => conflict.tripId === trip.id && !conflict.resolved).length,
  }));
}
