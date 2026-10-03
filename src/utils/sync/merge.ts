import type { ChangeBundle, ChangeOp, ConflictCandidate, DayPlanTransport, ItemPatch, PendingConflict, ReconciledState } from '../../models/sync';
import { CHANGE_KIND, CONFLICT_REASON } from '../../constants/sync';
import { slotsOverlap, today } from './time';

export function newRev(): string {
  return `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface DayItem {
  spot_id: string;
  start_time: string;
  end_time: string;
  note?: string;
  transport?: DayPlanTransport;
  [key: string]: unknown;
}

interface DayRecord {
  id: string;
  trip_id: string;
  day_index: number;
  date: string;
  items: DayItem[];
  [key: string]: unknown;
}

// 重联输入来自 Pinia 响应式状态（Proxy），structuredClone 会抛 DataCloneError；
// 状态本身是可 JSON 化的纯数据，统一走 JSON 深拷贝。
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function itemOriginKey(dayId: string, spotId: string) {
  return `dayPlans:${dayId}:item:${spotId}`;
}

function fieldOriginKey(entity: string, id: string, field: string) {
  return `${entity}:${id}:${field}`;
}

function findSameSlotConflict(state: ReconciledState, tripId: string, dayIndex: number, incoming: ItemPatch, otherSpotId: string) {
  const spotPair = [incoming.spot_id, otherSpotId].sort().join('|');
  return state.conflicts.find(
    (conflict) =>
      !conflict.resolved &&
      conflict.reason === CONFLICT_REASON.SAME_SLOT &&
      conflict.tripId === tripId &&
      conflict.dayIndex === dayIndex &&
      conflict.candidates.map((candidate) => candidate.item?.spot_id || '').sort().join('|') === spotPair,
  );
}

function findFieldConflict(state: ReconciledState, entity: string, entityId: string, field: string) {
  return state.conflicts.find(
    (conflict) =>
      !conflict.resolved &&
      conflict.reason === CONFLICT_REASON.FIELD &&
      conflict.tripId === (entity === 'trips' ? entityId : '') &&
      conflict.field === `${entity}:${entityId}:${field}`,
  );
}

/**
 * 把分叉包顺序并入重联结果。
 * strict=false：本地草稿投影（自己未同步的落笔直接呈现，不生成冲突）。
 * strict=true：重联合并（不同设备对同一时段/同一字段的分歧留两份待裁决）。
 */
export function reconcile(initial: ReconciledState, bundles: ChangeBundle[], strict: boolean): ReconciledState {
  const state = clone(initial);
  const tripMap = new Map<string, Record<string, unknown>>(state.trips.map((trip) => [String(trip.id), trip]));
  const dayMap = new Map<string, DayRecord>(state.dayPlans.map((day) => [String((day as { id?: string }).id), day as unknown as DayRecord]));

  const pending = bundles
    .map((bundle, order) => ({ bundle, order }))
    .filter(({ bundle }) => !state.mergedBundleIds.includes(bundle.id))
    .sort((a, b) => a.bundle.createdAt.localeCompare(b.bundle.createdAt) || a.order - b.order);

  for (const { bundle } of pending) {
    state.provenance[bundle.id] = { deviceLabel: bundle.deviceLabel, at: bundle.createdAt, amount: bundle.amount };
    // 检查点包：原始 ops 已折叠，只登记出处，不再重放
    if (bundle.status === 'checkpoint') {
      state.mergedBundleIds.push(bundle.id);
      continue;
    }
    for (const op of bundle.ops) {
      applyOp(state, tripMap, dayMap, bundle, op, strict);
    }
    state.mergedBundleIds.push(bundle.id);
  }

  state.trips = [...tripMap.values()];
  state.dayPlans = [...dayMap.values()];
  state.parentRev = initial.rev;
  state.rev = newRev();
  state.updatedAt = new Date().toISOString();
  return state;
}

function applyOp(
  state: ReconciledState,
  tripMap: Map<string, Record<string, unknown>>,
  dayMap: Map<string, DayRecord>,
  bundle: ChangeBundle,
  op: ChangeOp,
  strict: boolean,
) {
  if (op.kind === CHANGE_KIND.RESOLUTION) {
    applyResolution(state, dayMap, op, bundle);
    return;
  }

  if (op.kind === CHANGE_KIND.ENTITY_REMOVE) {
    if (op.entity === 'trips') tripMap.delete(op.entityId);
    else dayMap.delete(op.entityId);
    return;
  }

  if (op.kind === CHANGE_KIND.ENTITY_UPSERT) {
    if (op.entity !== 'trips') return;
    let trip = tripMap.get(op.entityId);
    if (!trip) {
      trip = { id: op.entityId };
      tripMap.set(op.entityId, trip);
    }
    for (const [field, newVal] of Object.entries(op.patch)) {
      const key = fieldOriginKey('trips', op.entityId, field);
      if (deepEqual(trip[field], newVal)) continue;
      const ownerBundle = state.origins[key];
      if (!strict || !ownerBundle || ownerBundle === bundle.id) {
        trip[field] = newVal;
        state.origins[key] = bundle.id;
        continue;
      }
      const baseVal = bundle.baseline.trips[op.entityId]?.[field];
      if (!deepEqual(baseVal, trip[field]) && !deepEqual(baseVal, newVal)) {
        registerFieldConflict(state, op.entityId, field, baseVal, trip[field], newVal, ownerBundle!, bundle);
        // 争议字段在裁决前保持基准值：两份候选都不进唯一结果
        if (baseVal !== undefined) trip[field] = baseVal;
      } else {
        trip[field] = newVal;
        state.origins[key] = bundle.id;
      }
    }
    return;
  }

  // 条目级：当天路线的增删
  const dayId = op.entityId;
  let day = dayMap.get(dayId);
  if (!day) {
    if (op.kind === CHANGE_KIND.ITEM_REMOVE) return;
    day = { id: dayId, trip_id: op.tripId, day_index: op.dayIndex, date: op.date, items: [] };
    dayMap.set(dayId, day);
  }

  const incoming = normalizeItem(op.item);
  const index = day.items.findIndex((item) => item.spot_id === incoming.spot_id);
  const key = itemOriginKey(dayId, incoming.spot_id);
  const ownerBundle = state.origins[key];

  if (op.kind === CHANGE_KIND.ITEM_REMOVE) {
    if (index >= 0) day.items.splice(index, 1);
    return;
  }

  if (index >= 0 && deepEqual(day.items[index], incoming)) return;

  // 同日不同景点、时间区间相交 => 同一时段冲突（看在位条目是否来自别的分叉包）
  const clash = day.items.find((item) => item.spot_id !== incoming.spot_id && slotsOverlap(item.start_time, item.end_time, incoming.start_time, incoming.end_time));
  const clashOwner = clash ? state.origins[itemOriginKey(dayId, clash.spot_id)] : undefined;

  // 新条目撞上别的分叉包已写入的在位条目 => 分叉冲突，双方撤出待裁决
  if (clash && clashOwner && clashOwner !== bundle.id) {
    registerSlotConflict(state, op, day, clash, incoming, clashOwner, bundle);
    day.items = day.items.filter((item) => item.spot_id !== clash.spot_id);
    return;
  }

  if (!strict || !ownerBundle || ownerBundle === bundle.id) {
    if (index >= 0) day.items.splice(index, 1, incoming);
    else day.items.push(incoming);
    state.origins[key] = bundle.id;
    return;
  }

  // 同景点改动：基准里就有该条目，双方各自落笔 => 同一景点分歧，双方撤出待裁决
  const baseDay = bundle.baseline.dayPlans[dayId];
  const baseItem = baseDay ? (baseDay.items as ItemPatch[] | undefined)?.find((item) => item.spot_id === incoming.spot_id) : undefined;
  const incumbent = index >= 0 ? day.items[index] : undefined;
  const sameSpotDiverged = incumbent && baseItem && !deepEqual(baseItem, incumbent) && !deepEqual(baseItem, incoming);

  if (sameSpotDiverged) {
    const incumbentBundle = state.origins[itemOriginKey(dayId, incumbent!.spot_id)] || ownerBundle;
    registerSlotConflict(state, op, day, incumbent!, incoming, incumbentBundle, bundle);
    day.items = day.items.filter((item) => item.spot_id !== incoming.spot_id);
  } else {
    if (index >= 0) day.items.splice(index, 1, incoming);
    else day.items.push(incoming);
    state.origins[key] = bundle.id;
  }
}

function normalizeItem(item: ItemPatch): DayItem {
  return {
    spot_id: item.spot_id,
    start_time: item.start_time,
    end_time: item.end_time,
    note: item.note ?? '',
    transport: item.transport ?? 'metro',
  };
}

function registerFieldConflict(
  state: ReconciledState,
  tripId: string,
  field: string,
  _baseVal: unknown,
  prevVal: unknown,
  newVal: unknown,
  prevBundleId: string,
  bundle: ChangeBundle,
) {
  const fullField = `trips:${tripId}:${field}`;
  let conflict = findFieldConflict(state, 'trips', tripId, field);
  const prevCandidate: ConflictCandidate = { bundleId: prevBundleId, deviceLabel: state.provenance[prevBundleId]?.deviceLabel || '手机', at: state.provenance[prevBundleId]?.at || '', amount: state.provenance[prevBundleId]?.amount || 0, field, value: prevVal };
  const nextCandidate: ConflictCandidate = { bundleId: bundle.id, deviceLabel: bundle.deviceLabel, at: bundle.createdAt, amount: bundle.amount, field, value: newVal };
  if (!conflict) {
    conflict = {
      id: `conflict:${fullField}`,
      tripId,
      date: today(),
      reason: CONFLICT_REASON.FIELD,
      field: fullField,
      candidates: [prevCandidate, nextCandidate],
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    state.conflicts.push(conflict);
  } else {
    if (!conflict.candidates.some((candidate) => candidate.bundleId === bundle.id)) conflict.candidates.push(nextCandidate);
  }
}

function registerSlotConflict(
  state: ReconciledState,
  op: Extract<ChangeOp, { kind: 'item-upsert' | 'item-remove' }>,
  day: DayRecord,
  incumbent: ItemPatch,
  incoming: ItemPatch,
  incumbentBundleId: string,
  bundle: ChangeBundle,
) {
  const incumbentCandidate: ConflictCandidate = {
    bundleId: incumbentBundleId,
    deviceLabel: state.provenance[incumbentBundleId]?.deviceLabel || '手机',
    at: state.provenance[incumbentBundleId]?.at || '',
    amount: state.provenance[incumbentBundleId]?.amount || 0,
    item: normalizeItem(incumbent),
  };
  const incomingCandidate: ConflictCandidate = { bundleId: bundle.id, deviceLabel: bundle.deviceLabel, at: bundle.createdAt, amount: bundle.amount, item: normalizeItem(incoming) };

  const otherSpot = incumbent.spot_id === incoming.spot_id ? day.items.find((item) => item.spot_id !== incoming.spot_id)?.spot_id || incoming.spot_id : incumbent.spot_id;
  let conflict = findSameSlotConflict(state, op.tripId, op.dayIndex, incoming, otherSpot);
  if (!conflict) {
    conflict = {
      id: `conflict:slot:${op.tripId}:${op.dayIndex}:${[incoming.spot_id, otherSpot].sort().join('|')}`,
      tripId: op.tripId,
      dayIndex: op.dayIndex,
      date: op.date,
      reason: CONFLICT_REASON.SAME_SLOT,
      candidates: [incumbentCandidate, incomingCandidate],
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    state.conflicts.push(conflict);
  } else if (!conflict.candidates.some((candidate) => candidate.bundleId === bundle.id)) {
    conflict.candidates.push(incomingCandidate);
  }
}

function applyResolution(state: ReconciledState, dayMap: Map<string, DayRecord>, op: Extract<ChangeOp, { kind: 'resolution' }>, bundle: ChangeBundle) {
  const conflict = state.conflicts.find((item) => item.id === op.conflictId && !item.resolved);
  if (!conflict) return;
  const chosen = conflict.candidates.find((candidate) => candidate.bundleId === op.chosenBundleId);
  if (!chosen) return;

  if (conflict.reason === CONFLICT_REASON.SAME_SLOT && chosen.item) {
    const dayId = `day-${conflict.tripId}-${conflict.dayIndex}`;
    let day = dayMap.get(dayId);
    if (!day) {
      day = { id: dayId, trip_id: conflict.tripId, day_index: conflict.dayIndex!, date: conflict.date, items: [] };
      dayMap.set(dayId, day);
    }
    // 清掉同槽位的其他候选，落定选中的一份
    day.items = day.items.filter((item) => !conflict.candidates.some((candidate) => candidate.item?.spot_id === item.spot_id && slotsOverlap(candidate.item!.start_time, candidate.item!.end_time, item.start_time, item.end_time)));
    day.items.push(normalizeItem(chosen.item));
    state.origins[itemOriginKey(dayId, chosen.item.spot_id)] = chosen.bundleId;
  } else if (conflict.reason === CONFLICT_REASON.FIELD && conflict.field) {
    const [entity, entityId, ...rest] = conflict.field.split(':');
    const field = rest.join(':');
    const trip = state.trips.find((item) => String(item.id) === entityId);
    if (trip && entity === 'trips') {
      trip[field] = chosen.value;
      state.origins[fieldOriginKey(entity, entityId, field)] = chosen.bundleId;
    }
  }

  conflict.resolved = true;
  conflict.chosenBundleId = chosen.bundleId;
  conflict.resolvedAt = new Date().toISOString();
  state.conflicts = state.conflicts.filter((item) => item.id !== conflict!.id);
  state.resolved.push(conflict);
  state.provenance[bundle.id] = { deviceLabel: bundle.deviceLabel, at: bundle.createdAt, amount: bundle.amount };
}

export function emptyReconciled(): ReconciledState {
  const rev = newRev();
  return {
    rev,
    parentRev: rev,
    updatedAt: new Date().toISOString(),
    trips: [],
    dayPlans: [],
    mergedBundleIds: [],
    conflicts: [],
    resolved: [],
    origins: {},
    provenance: {},
  };
}
