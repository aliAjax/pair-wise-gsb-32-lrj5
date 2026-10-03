// 三方合并：base（各自基准）/ local（本机分叉）/ remote（云端另一家的分叉）
// 不冲突的改动一起生效；同一字段/同一时段两边改成不同结果时，留两份待选。

import type { Trip } from '../models/trip';
import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import type { BundleOp, ConflictChoice, ConflictSlotType, PendingConflict } from '../models/sync';
import { TRIP_FIELDS, applyOps, cloneWorld, emptyWorld, type World } from './world';
import { isOverlapping } from './timeslot';

export interface MergeSide {
  deviceId: string;
  deviceLabel: string;
}

export interface MergeResult {
  world: World;
  ops: BundleOp[];
  conflicts: PendingConflict[];
}

const dayKey = (tripId: string, dayIndex: number) => `${tripId}#${dayIndex}`;

function buildDayIndex(world: World) {
  const map = new Map<string, DayPlan>();
  Object.values(world.days).forEach((day) => map.set(dayKey(day.trip_id, day.day_index), day));
  return map;
}

function makeConflictId() {
  return 'conflict-' + crypto.randomUUID();
}

function makeChoice(device: MergeSide, bundleId: string, label: string): ConflictChoice {
  return { label, device_id: device.deviceId, bundle_id: bundleId };
}

// 字段中文标签（日期与金额是重点保护对象）
const TRIP_FIELD_LABEL: Record<string, string> = {
  title: '标题',
  destination: '目的地',
  start_date: '出发日期',
  end_date: '结束日期',
  budget: '预算金额',
  currency: '币种',
  members: '同行人',
  status: '状态',
};

export function mergeThreeWay(
  base: World,
  local: World,
  remote: World,
  localSide: MergeSide,
  remoteSide: MergeSide,
  now: string,
  localBundleIds: string[] = [],
  remoteBundleIds: string[] = [],
): MergeResult {
  const merged = emptyWorld();
  const conflicts: PendingConflict[] = [];
  const localBundleId = localBundleIds[localBundleIds.length - 1] || '';
  const remoteBundleId = remoteBundleIds[remoteBundleIds.length - 1] || '';

  // —— Trip 级：逐字段三方合并 ——
  const tripIds = new Set([...Object.keys(base.trips), ...Object.keys(local.trips), ...Object.keys(remote.trips)]);
  tripIds.forEach((tripId) => {
    const b = base.trips[tripId];
    const l = local.trips[tripId];
    const r = remote.trips[tripId];

    if (b && !l && !r) return; // 两边都删：删除生效
    if (b && !l && r) {
      // 本机删除 vs 对方保留
      if (JSON.stringify(stripTrip(b)) === JSON.stringify(stripTrip(r))) return; // 对方没动：删除生效
      conflicts.push({
        id: makeConflictId(), trip_id: tripId, slot: 'trip', slot_key: `trip:${tripId}:existence`,
        title: '一方删除了整趟旅行，另一方还在修改',
        choices: [makeChoice(localSide, localBundleId, `删除旅行（${localSide.deviceLabel}）`), makeChoice(remoteSide, remoteBundleId, `保留修改（${remoteSide.deviceLabel}）`)],
        created_at: now,
        op_a: { kind: 'trip-remove', tripId },
        op_b: { kind: 'trip-upsert', tripId, fields: changedTripFields(b, r) },
      });
      merged.trips[tripId] = JSON.parse(JSON.stringify(b));
      return;
    }
    if (b && l && !r) {
      // 对方删除 vs 本机保留
      if (JSON.stringify(stripTrip(b)) === JSON.stringify(stripTrip(l))) return;
      conflicts.push({
        id: makeConflictId(), trip_id: tripId, slot: 'trip', slot_key: `trip:${tripId}:existence`,
        title: '一方删除了整趟旅行，另一方还在修改',
        choices: [makeChoice(localSide, localBundleId, `保留修改（${localSide.deviceLabel}）`), makeChoice(remoteSide, remoteBundleId, `删除旅行（${remoteSide.deviceLabel}）`)],
        created_at: now,
        op_a: { kind: 'trip-upsert', tripId, fields: changedTripFields(b, l) },
        op_b: { kind: 'trip-remove', tripId },
      });
      merged.trips[tripId] = JSON.parse(JSON.stringify(b));
      return;
    }
    if (!l && !r) return;

    // 旅行只存在于一方（离线新建 / 对方已创建本机还没见过）：直接接纳
    if (!b && (!l || !r)) {
      const present = (l || r) as Trip;
      merged.trips[tripId] = JSON.parse(JSON.stringify(present));
      return;
    }

    // 以 local 完整对象为底（保留 id / created_at 等非合并字段），再逐字段三方裁决
    const baseFields = b ? stripTrip(b) : ({} as Record<string, unknown>);
    const localFields = stripTrip(l as Trip);
    const remoteFields = stripTrip(r as Trip);
    const output: Record<string, unknown> = { ...JSON.parse(JSON.stringify(l)) };

    TRIP_FIELDS.forEach((field) => {
      const bv = baseFields[field];
      const lv = localFields[field];
      const rv = remoteFields[field];
      if (!b) {
        // 新增旅行：以创建方数据为准，另一边若也改了同字段（极少）直接合并
        output[field] = lv ?? rv;
        return;
      }
      const localChanged = JSON.stringify(lv) !== JSON.stringify(bv);
      const remoteChanged = JSON.stringify(rv) !== JSON.stringify(bv);
      if (!localChanged && remoteChanged) output[field] = rv;
      else if (localChanged && !remoteChanged) output[field] = lv;
      else if (localChanged && remoteChanged && JSON.stringify(lv) !== JSON.stringify(rv)) {
        // 同一字段两边改成不同值：保留基准，两份待选（日期、金额最常见）
        conflicts.push({
          id: makeConflictId(), trip_id: tripId, slot: 'trip', slot_key: `trip:${tripId}:field:${field}`,
          title: `${TRIP_FIELD_LABEL[field] || field}两边改成了不同的值`,
          choices: [
            makeChoice(localSide, localBundleId, `${TRIP_FIELD_LABEL[field] || field}=${displayValue(lv)}（${localSide.deviceLabel}）`),
            makeChoice(remoteSide, remoteBundleId, `${TRIP_FIELD_LABEL[field] || field}=${displayValue(rv)}（${remoteSide.deviceLabel}）`),
          ],
          created_at: now,
          op_a: { kind: 'trip-upsert', tripId, fields: { [field]: lv } },
          op_b: { kind: 'trip-upsert', tripId, fields: { [field]: rv } },
        });
        output[field] = bv; // 裁决前认同基准
      }
    });
    merged.trips[tripId] = output as unknown as Trip;
  });

  mergeDays(base, local, remote, merged, conflicts, localSide, remoteSide, now, localBundleId, remoteBundleId);
  return { world: merged, ops: diffWorlds(base, merged), conflicts };
}

function stripTrip(trip: Trip) {
  return {
    title: trip.title,
    destination: trip.destination,
    start_date: trip.start_date,
    end_date: trip.end_date,
    budget: trip.budget,
    currency: trip.currency,
    members: trip.members,
    status: trip.status,
  };
}

function displayValue(value: unknown) {
  return Array.isArray(value) ? value.join('、') : String(value);
}

function changedTripFields(before: Trip, after: Trip): import('../models/sync').BundleTripFields {
  const out: Record<string, unknown> = {};
  TRIP_FIELDS.forEach((field) => {
    if (JSON.stringify(before[field as keyof Trip]) !== JSON.stringify(after[field as keyof Trip])) {
      out[field] = after[field as keyof Trip];
    }
  });
  return out as unknown as import('../models/sync').BundleTripFields;
}

interface DayTriple {
  key: string;
  tripId: string;
  dayIndex: number;
  base?: DayPlan;
  local?: DayPlan;
  remote?: DayPlan;
  canonicalId: string;
}

function mergeDays(
  base: World, local: World, remote: World, merged: World,
  conflicts: PendingConflict[], localSide: MergeSide, remoteSide: MergeSide,
  now: string, localBundleId: string, remoteBundleId: string,
) {
  const baseDays = buildDayIndex(base);
  const localDays = buildDayIndex(local);
  const remoteDays = buildDayIndex(remote);
  const keys = new Set([...baseDays.keys(), ...localDays.keys(), ...remoteDays.keys()]);

  keys.forEach((key) => {
    const b = baseDays.get(key);
    const l = localDays.get(key);
    const r = remoteDays.get(key);
    const [tripId, dayIndexRaw] = key.split('#');
    const dayIndex = Number(dayIndexRaw);

    if (b && !l && !r) return;
    if (b && !l && r && sameDayShape(b, r)) return; // 本机删除、对方没动：删除生效
    if (b && l && !r && sameDayShape(b, l)) {
      // 对方删除、本机没动：删除生效
      return;
    }
    if (!l && !r) return;

    if (b && ((!l && r) || (l && !r))) {
      // 删除 vs 内容修改
      const survivor = (l || r) as DayPlan;
      const deletingSide = l ? remoteSide : localSide;
      const keepingSide = l ? localSide : remoteSide;
      const changed = !sameDayShape(b, survivor);
      if (!changed) return;
      conflicts.push({
        id: makeConflictId(), trip_id: tripId, day_id: b.id, slot: 'day', slot_key: `day:${key}:existence`,
        title: `第 ${dayIndex} 天一方删除、另一方仍在修改`,
        choices: [
          makeChoice(deletingSide, deletingSide === localSide ? localBundleId : remoteBundleId, `删除第 ${dayIndex} 天（${deletingSide.deviceLabel}）`),
          makeChoice(keepingSide, keepingSide === localSide ? localBundleId : remoteBundleId, `保留当天安排（${keepingSide.deviceLabel}）`),
        ],
        created_at: now,
        op_a: { kind: 'day-remove', tripId, dayId: b.id },
        op_b: { kind: 'day-upsert', tripId, dayId: survivor.id, dayIndex, fields: { date: survivor.date } },
      });
      merged.days[b.id] = JSON.parse(JSON.stringify(b));
      return;
    }

    // 规范化 day id：基准优先；两边同一天新建时用 local 的 id 把 remote 条目并进来
    const canonicalId = b?.id || l?.id || (r as DayPlan).id;
    const baseDate = b?.date ?? '';
    const localDate = l?.date ?? '';
    const remoteDate = r?.date ?? '';
    let canonicalDate = baseDate;
    const localDateChanged = !b || localDate !== baseDate;
    const remoteDateChanged = !b || remoteDate !== baseDate;
    if (!b) canonicalDate = localDate || remoteDate;
    else if (!localDateChanged && remoteDateChanged) canonicalDate = remoteDate;
    else if (localDateChanged && !remoteDateChanged) canonicalDate = localDate;
    else if (localDateChanged && remoteDateChanged && localDate !== remoteDate) {
      conflicts.push({
        id: makeConflictId(), trip_id: tripId, day_id: canonicalId, slot: 'day', slot_key: `day:${key}:date`,
        title: `第 ${dayIndex} 天的日期两边选得不一样`,
        choices: [
          makeChoice(localSide, localBundleId, `${localDate}（${localSide.deviceLabel}）`),
          makeChoice(remoteSide, remoteBundleId, `${remoteDate}（${remoteSide.deviceLabel}）`),
        ],
        created_at: now,
        op_a: { kind: 'day-upsert', tripId, dayId: canonicalId, dayIndex, fields: { date: localDate } },
        op_b: { kind: 'day-upsert', tripId, dayId: canonicalId, dayIndex, fields: { date: remoteDate } },
      });
      canonicalDate = baseDate;
    }

    const outDay: DayPlan = { id: canonicalId, trip_id: tripId, day_index: dayIndex, date: canonicalDate, items: [] };
    merged.days[canonicalId] = outDay;

    mergeItems(b, l, r, outDay, conflicts, localSide, remoteSide, now, localBundleId, remoteBundleId, dayIndex, key);
  });
}

function sameDayShape(a: DayPlan, b: DayPlan) {
  return a.date === b.date && JSON.stringify(a.items) === JSON.stringify(b.items);
}

function mergeItems(
  b: DayPlan | undefined, l: DayPlan | undefined, r: DayPlan | undefined,
  outDay: DayPlan, conflicts: PendingConflict[],
  localSide: MergeSide, remoteSide: MergeSide, now: string,
  localBundleId: string, remoteBundleId: string, dayIndex: number, dayNaturalKey: string,
) {
  // 注意：远端新建 day 时 id 与本机不同，条目本身 id 仍全局唯一
  const baseItems = new Map((b?.items || []).map((item) => [item.id, item]));
  const localItems = new Map((l?.items || []).map((item) => [item.id, item]));
  const remoteItems = new Map((r?.items || []).map((item) => [item.id, item]));
  const localAdded = (l?.items || []).filter((item) => !baseItems.has(item.id));
  const remoteAdded = (r?.items || []).filter((item) => !baseItems.has(item.id));
  const consumedRemote = new Set<string>();

  // 双方新增条目：同一时段（重叠 或 同景点同时段）的判定
  localAdded.forEach((localItem) => {
    const clash = remoteAdded.find((remoteItem) => {
      if (consumedRemote.has(remoteItem.id)) return false;
      const sameSpotSameTime = remoteItem.spot_id === localItem.spot_id && remoteItem.start_time === localItem.start_time;
      if (sameSpotSameTime) return true; // 视为同一安排的重复提交
      return isOverlapping(localItem.start_time, localItem.end_time, remoteItem.start_time, remoteItem.end_time);
    });
    if (!clash) {
      outDay.items.push(JSON.parse(JSON.stringify(localItem)));
      return;
    }
    consumedRemote.add(clash.id);
    const sameSpotSameTime = clash.spot_id === localItem.spot_id && clash.start_time === localItem.start_time;
    if (sameSpotSameTime) {
      // 完全重复：非冲突，只生效一份
      outDay.items.push(JSON.parse(JSON.stringify(localItem)));
      return;
    }
    // 同一时段两份不同安排：都先挂起，留两份待选，裁决前不生效、不计费用
    conflicts.push({
      id: makeConflictId(), trip_id: outDay.trip_id, day_id: outDay.id, slot: 'item',
      slot_key: `day:${dayNaturalKey}:timeslot:${localItem.start_time}:${clash.start_time}`,
      title: `第 ${dayIndex} 天 ${localItem.start_time} 时段有两份安排`,
      choices: [
        makeChoice(localSide, localBundleId, `${localItem.start_time}-${localItem.end_time}（${localSide.deviceLabel}）`),
        makeChoice(remoteSide, remoteBundleId, `${clash.start_time}-${clash.end_time}（${remoteSide.deviceLabel}）`),
      ],
      created_at: now,
      op_a: { kind: 'item-upsert', tripId: outDay.trip_id, dayId: outDay.id, item: JSON.parse(JSON.stringify(localItem)) },
      op_b: { kind: 'item-upsert', tripId: outDay.trip_id, dayId: outDay.id, item: JSON.parse(JSON.stringify(clash)) },
    });
  });
  remoteAdded.forEach((remoteItem) => {
    if (!consumedRemote.has(remoteItem.id)) outDay.items.push(JSON.parse(JSON.stringify(remoteItem)));
  });

  // 基准已有条目：修改 / 删除的三方合并
  baseItems.forEach((baseItem, itemId) => {
    const li = localItems.get(itemId);
    const ri = remoteItems.get(itemId);
    const localRemoved = !li;
    const remoteRemoved = !ri;
    if (localRemoved && remoteRemoved) return;
    if (localRemoved || remoteRemoved) {
      const survivor = (li || ri) as DayPlanItem | undefined;
      const changed = survivor && JSON.stringify(survivor) !== JSON.stringify(baseItem);
      if (!changed) return; // 只有删除方动了：删除生效
      const deletingSide = localRemoved ? localSide : remoteSide;
      const keepingSide = localRemoved ? remoteSide : localSide;
      conflicts.push({
        id: makeConflictId(), trip_id: outDay.trip_id, day_id: outDay.id, slot: 'item',
        slot_key: `day:${dayNaturalKey}:item:${itemId}:existence`,
        title: `一项安排一方删除、另一方改了时间或备注`,
        choices: [
          makeChoice(deletingSide, localRemoved ? localBundleId : remoteBundleId, `删除这项（${deletingSide.deviceLabel}）`),
          makeChoice(keepingSide, localRemoved ? remoteBundleId : localBundleId, `保留修改（${keepingSide.deviceLabel}）`),
        ],
        created_at: now,
        op_a: localRemoved
          ? { kind: 'item-remove', tripId: outDay.trip_id, dayId: outDay.id, itemId }
          : { kind: 'item-upsert', tripId: outDay.trip_id, dayId: outDay.id, item: JSON.parse(JSON.stringify(li)) },
        op_b: remoteRemoved
          ? { kind: 'item-remove', tripId: outDay.trip_id, dayId: outDay.id, itemId }
          : { kind: 'item-upsert', tripId: outDay.trip_id, dayId: outDay.id, item: JSON.parse(JSON.stringify(ri)) },
      });
      outDay.items.push(JSON.parse(JSON.stringify(baseItem))); // 挂起，保留基准
      return;
    }
    const localChanged = JSON.stringify(li) !== JSON.stringify(baseItem);
    const remoteChanged = JSON.stringify(ri) !== JSON.stringify(baseItem);
    if (!localChanged && remoteChanged) outDay.items.push(JSON.parse(JSON.stringify(ri)));
    else if (localChanged && !remoteChanged) outDay.items.push(JSON.parse(JSON.stringify(li)));
    else if (localChanged && remoteChanged && JSON.stringify(li) !== JSON.stringify(ri)) {
      // 同一条目两边改得不一样（含时段改动）：留两份待选
      conflicts.push({
        id: makeConflictId(), trip_id: outDay.trip_id, day_id: outDay.id, slot: 'item',
        slot_key: `day:${dayNaturalKey}:item:${itemId}`,
        title: `同一项安排两边改成了不同时段/备注`,
        choices: [
          makeChoice(localSide, localBundleId, `${li.start_time}-${li.end_time}（${localSide.deviceLabel}）`),
          makeChoice(remoteSide, remoteBundleId, `${ri.start_time}-${ri.end_time}（${remoteSide.deviceLabel}）`),
        ],
        created_at: now,
        op_a: { kind: 'item-upsert', tripId: outDay.trip_id, dayId: outDay.id, item: JSON.parse(JSON.stringify(li)) },
        op_b: { kind: 'item-upsert', tripId: outDay.trip_id, dayId: outDay.id, item: JSON.parse(JSON.stringify(ri)) },
      });
      outDay.items.push(JSON.parse(JSON.stringify(baseItem)));
    } else {
      outDay.items.push(JSON.parse(JSON.stringify(li)));
    }
  });

  // 排序冲突：两边对同一组条目拖出不同顺序
  if (b && l && r) {
    const orderOf = (day: DayPlan) => day.items.map((item) => item.id).filter((id) => baseItems.has(id));
    const bo = orderOf(b);
    const lo = orderOf(l);
    const ro = orderOf(r);
    if (JSON.stringify(lo) !== JSON.stringify(ro) && (JSON.stringify(lo) !== JSON.stringify(bo) || JSON.stringify(ro) !== JSON.stringify(bo))) {
      conflicts.push({
        id: makeConflictId(), trip_id: outDay.trip_id, day_id: outDay.id, slot: 'order',
        slot_key: `day:${dayNaturalKey}:order`,
        title: `第 ${dayIndex} 天两边拖出了不同的游玩顺序`,
        choices: [
          makeChoice(localSide, localBundleId, `按${localSide.deviceLabel}的顺序`),
          makeChoice(remoteSide, remoteBundleId, `按${remoteSide.deviceLabel}的顺序`),
        ],
        created_at: now,
        op_a: { kind: 'order', tripId: outDay.trip_id, dayId: outDay.id, itemIds: lo },
        op_b: { kind: 'order', tripId: outDay.trip_id, dayId: outDay.id, itemIds: ro },
      });
    } else if (JSON.stringify(lo) === JSON.stringify(ro)) {
      applyOrderTo(outDay, lo);
    } else if (JSON.stringify(lo) !== JSON.stringify(bo)) {
      applyOrderTo(outDay, lo);
    } else {
      applyOrderTo(outDay, ro);
    }
  } else {
    // 新增条目按开始时间排，基准条目维持可获得的顺序
    outDay.items.sort((a, c) => a.start_time.localeCompare(c.start_time));
  }
}

function applyOrderTo(day: DayPlan, ids: string[]) {
  const byId = new Map(day.items.map((item) => [item.id, item]));
  const ordered: DayPlanItem[] = [];
  ids.forEach((id) => {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  });
  byId.forEach((item) => ordered.push(item));
  day.items = ordered;
}

// —— 把合并后的世界相对基准做差，生成合并包需要的净操作 ——
export function diffWorlds(base: World, target: World): BundleOp[] {
  const ops: BundleOp[] = [];
  const allTripIds = new Set([...Object.keys(base.trips), ...Object.keys(target.trips)]);
  allTripIds.forEach((tripId) => {
    const b = base.trips[tripId];
    const t = target.trips[tripId];
    if (b && !t) {
      ops.push({ kind: 'trip-remove', tripId });
      return;
    }
    if (!t) return;
    const fields = b ? changedTripFields(b, t) : (stripTrip(t) as import('../models/sync').BundleTripFields);
    if (!b || Object.keys(fields).length) ops.push({ kind: 'trip-upsert', tripId, fields });
  });

  const baseDayById = new Map(Object.values(base.days).map((day) => [day.id, day]));
  const targetDayById = new Map(Object.values(target.days).map((day) => [day.id, day]));
  baseDayById.forEach((b, dayId) => {
    if (!targetDayById.has(dayId)) ops.push({ kind: 'day-remove', tripId: b.trip_id, dayId });
  });
  targetDayById.forEach((t, dayId) => {
    const b = baseDayById.get(dayId);
    if (!b) {
      ops.push({ kind: 'day-upsert', tripId: t.trip_id, dayId, dayIndex: t.day_index, fields: { date: t.date } });
    } else if (b.date !== t.date) {
      ops.push({ kind: 'day-upsert', tripId: t.trip_id, dayId, dayIndex: t.day_index, fields: { date: t.date } });
    }
    diffItems(b, t, ops);
  });
  return ops;
}

function diffItems(b: DayPlan | undefined, t: DayPlan, ops: BundleOp[]) {
  const baseItems = new Map((b?.items || []).map((item) => [item.id, item]));
  const targetItems = new Map(t.items.map((item) => [item.id, item]));
  baseItems.forEach((item, itemId) => {
    if (!targetItems.has(itemId)) ops.push({ kind: 'item-remove', tripId: t.trip_id, dayId: t.id, itemId });
  });
  targetItems.forEach((item, itemId) => {
    const old = baseItems.get(itemId);
    if (!old || JSON.stringify(old) !== JSON.stringify(item)) {
      ops.push({ kind: 'item-upsert', tripId: t.trip_id, dayId: t.id, item: JSON.parse(JSON.stringify(item)) });
    }
  });
  const before = (b?.items || []).map((item) => item.id);
  const after = t.items.map((item) => item.id);
  if (b && JSON.stringify(before) !== JSON.stringify(after) && b.items.length && t.items.length) {
    ops.push({ kind: 'order', tripId: t.trip_id, dayId: t.id, itemIds: after });
  }
}

// 从基准世界直接套用一串包（离线投影 / 重建用）
export function projectFrom(base: World, opsLists: BundleOp[][]): World {
  return opsLists.reduce((world, ops) => applyOps(world, ops), cloneWorld(base));
}
