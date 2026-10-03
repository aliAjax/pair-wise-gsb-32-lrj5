import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { SYNC_DEVICES, DEFAULT_SYNC_DEVICE, STORAGE_PRESSURE_RATIO, type SyncDeviceId } from '../constants/sync';
import { TripStatus } from '../constants/trip';
import type { BundleOp, PendingConflict, SyncBundle } from '../models/sync';
import type { DayPlan } from '../models/dayPlan';
import type { Trip } from '../models/trip';
import { applyOps, tripSnapshotFields, worldDays, worldFromLists, worldTrips, type World } from '../sync/world';
import { mergeThreeWay } from '../sync/merge';
import { compactOldest } from '../sync/compaction';
import { readLegacyData, ensureItemIds } from '../sync/backfill';
import {
  syncApi, serializeWorld, deserializeWorld,
  type CloudState, type DeviceLog,
} from '../sync/syncApi';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { seedSpots } from '../api/spotApi';

function nowIso() { return new Date().toISOString(); }
function newId(prefix: string) { return prefix + '-' + crypto.randomUUID(); }

const deviceLabel = (deviceId: string) => SYNC_DEVICES.find((item) => item.id === deviceId)?.label || deviceId;

// 首台设备没有任何数据时，用 v1 旧数据回填；再没有就用演示旅行初始化
function bootstrapWorld(existing: World | null): { world: World; usedLegacy: boolean } {
  if (existing && (Object.keys(existing.trips).length || Object.keys(existing.days).length)) {
    return { world: existing, usedLegacy: false };
  }
  const legacy = readLegacyData();
  if (legacy.hadLegacy || legacy.trips.length || legacy.dayPlans.length) {
    toast.ok(messages.backfilled);
    return { world: worldFromLists(legacy.trips, ensureItemIds(legacy.dayPlans)), usedLegacy: true };
  }
  return { world: demoWorld(), usedLegacy: false };
}

function demoWorld(): World {
  const tripId = 'trip-demo';
  const trip: Trip = {
    id: tripId,
    title: '杭州周末慢旅行',
    destination: '杭州',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    budget: 3200,
    currency: 'CNY',
    members: ['我', '家人'],
    status: TripStatus.PLANNING,
    created_at: nowIso(),
  };
  const day: DayPlan = { id: 'day-demo-1', trip_id: tripId, day_index: 1, date: trip.start_date, items: [
    { id: 'item-demo-1', spot_id: seedSpots[0].id, start_time: '09:00', end_time: '11:00', note: '苏堤散步', transport: 'metro' },
  ] };
  return worldFromLists([trip], [day]);
}

function baselineBundles(world: World, deviceId: string): SyncBundle[] {
  // 每个旅行一条出发基准包（不可压缩）
  return Object.values(world.trips).map((trip) => ({
    id: newId('base'),
    kind: 'baseline' as const,
    trip_id: trip.id,
    parent_id: null,
    device_id: deviceId,
    created_at: nowIso(),
    ops: [],
    snapshot: tripSnapshotFields(trip),
    message: `${trip.title} 的出发基准`,
    locked: true,
    synced: true,
  }));
}

export const useSyncStore = defineStore('sync', () => {
  const deviceId = ref<SyncDeviceId>(DEFAULT_SYNC_DEVICE);
  const online = ref(true);
  // 每台设备各自的分叉日志（基准世界 + 待推送包）
  const logs = ref<Record<string, DeviceLog>>({});
  // 云端：唯一一份裁决结果 + 全量包历史 + 冲突清单
  const cloud = ref<CloudState>({
    canonical: { trips: [], dayPlans: [] },
    bundles: [],
    conflicts: [],
    version: 0,
    updated_at: nowIso(),
  });
  const packs = ref(syncApi.loadPacks());
  const lastSyncAt = ref<string>('');
  const busy = ref(false);
  const compactionReport = ref('');

  // —— 世界投影 ——
  const canonicalWorld = computed<World>(() => deserializeWorld(cloud.value.canonical));
  const deviceLog = computed<DeviceLog | undefined>(() => logs.value[deviceId.value]);
  const baseWorld = computed<World>(() => deserializeWorld(deviceLog.value?.base ?? null));
  const localWorld = computed<World>(() => {
    const log = deviceLog.value;
    if (!log) return canonicalWorld.value;
    return (log.pending || []).reduce(
      (world, bundle) => applyOps(world, bundle.ops),
      deserializeWorld(log.base),
    );
  });
  // 列表 / 当天路线 / 分享页统一从这里取数：在线认云端裁决结果，断网认本机分叉投影
  const activeWorld = computed<World>(() => (online.value ? canonicalWorld.value : localWorld.value));

  const trips = computed<Trip[]>(() => worldTrips(activeWorld.value));
  const dayPlans = computed<DayPlan[]>(() => worldDays(activeWorld.value));
  const pendingBundles = computed<SyncBundle[]>(() => deviceLog.value?.pending || []);
  const pendingCount = computed(() => pendingBundles.value.length);
  const unresolvedConflicts = computed<PendingConflict[]>(() => cloud.value.conflicts.filter((item) => !item.resolved_choice));
  const unresolvedCount = computed(() => unresolvedConflicts.value.length);
  const allConflicts = computed(() => cloud.value.conflicts);

  function ensureDevice(target: SyncDeviceId): DeviceLog {
    let log = logs.value[target];
    if (log) return log;

    const existingCloud = syncApi.loadCloud();
    if (existingCloud && existingCloud.version > 0) {
      // 第二台设备（车机）接入：以云端裁决结果为自己的分叉基准
      log = {
        device_id: target,
        base: JSON.parse(JSON.stringify(existingCloud.canonical)),
        pending: [],
        tip_id: null,
        backfilled: true,
      };
    } else {
      // 首台设备：旧数据缺版本先回填
      const { world } = bootstrapWorld(syncApi.loadCloud() ? deserializeWorld(syncApi.loadCloud()!.canonical) : null);
      const serialized = serializeWorld(world);
      const bases = baselineBundles(world, target);
      cloud.value = {
        canonical: serialized,
        bundles: bases,
        conflicts: [],
        version: 1,
        updated_at: nowIso(),
      };
      syncApi.saveCloud(cloud.value, () => runCompaction());
      log = { device_id: target, base: serialized, pending: [], tip_id: null, backfilled: true };
      syncApi.markBackfilled(target);
    }
    logs.value[target] = log;
    syncApi.saveDevice(target, log, () => runCompaction());
    return log;
  }

  function persistDevice() {
    const log = deviceLog.value;
    if (log) syncApi.saveDevice(deviceId.value, log, () => runCompaction());
  }
  function persistCloud() {
    cloud.value.updated_at = nowIso();
    syncApi.saveCloud(cloud.value, () => runCompaction());
  }

  // —— 落笔保存：生成一个可续作分叉包 ——
  function appendEdit(ops: BundleOp[], message: string, tripId: string, snapshotTrip?: Trip) {
    const log = ensureDevice(deviceId.value);
    const tripForSnapshot = snapshotTrip
      || Object.values(localWorld.value.trips).find((trip) => trip.id === tripId)
      || Object.values(canonicalWorld.value.trips).find((trip) => trip.id === tripId);
    const parentId = log.tip_id;
    const bundle: SyncBundle = {
      id: newId('bundle'),
      kind: 'edit',
      trip_id: tripId,
      parent_id: parentId,
      device_id: deviceId.value,
      created_at: nowIso(),
      ops: JSON.parse(JSON.stringify(ops)),
      snapshot: tripForSnapshot
        ? tripSnapshotFields(tripForSnapshot)
        : { start_date: '', end_date: '', budget: 0, currency: 'CNY' },
      message,
      synced: false,
    };
    log.pending.push(bundle);
    log.tip_id = bundle.id;
    persistDevice();
    if (online.value) {
      syncRound();
    } else {
      toast.ok(messages.offlineSaved);
    }
  }

  // —— 网络恢复后合并 ——
  let flushQueued = false;
  function syncRound() {
    if (busy.value) {
      // 合并进行中又落了新笔：标记尾刷，结束后再合一次，避免最后一笔留在 pending
      flushQueued = true;
      return;
    }
    const log = ensureDevice(deviceId.value);
    if (!log.pending.length) {
      // 没有本地改动也要拉取其他设备的云端裁决结果（刷新本机基准）
      const freshCloud = syncApi.loadCloud();
      if (freshCloud) cloud.value = freshCloud;
      lastSyncAt.value = nowIso();
      return;
    }
    busy.value = true;
    try {
      const freshCloud = syncApi.loadCloud() || cloud.value;
      const remoteWorld = deserializeWorld(freshCloud.canonical);
      const projectedLocal = log.pending.reduce(
        (world, bundle) => applyOps(world, bundle.ops),
        deserializeWorld(log.base),
      );

      const localSide = { deviceId: deviceId.value, deviceLabel: deviceLabel(deviceId.value) };
      const other = SYNC_DEVICES.find((item) => item.id !== deviceId.value);
      const remoteSide = { deviceId: other?.id || 'remote', deviceLabel: other?.label || '家人' };

      const merged = mergeThreeWay(
        deserializeWorld(log.base), projectedLocal, remoteWorld,
        localSide, remoteSide, nowIso(),
        log.pending.map((bundle) => bundle.id),
      );

      // 本机这批包标记已吸收并上云；再写一条 merge 包记住分叉汇合点
      const syncedEdits: SyncBundle[] = log.pending.map((bundle) => ({ ...bundle, synced: true, absorbed: true }));
      const mergeBundle: SyncBundle = {
        id: newId('merge'),
        kind: 'merge',
        trip_id: log.pending[0].trip_id,
        parent_id: log.tip_id,
        parent_ids: syncedEdits.map((bundle) => bundle.id),
        device_id: deviceId.value,
        created_at: nowIso(),
        ops: merged.ops,
        snapshot: { start_date: '', end_date: '', budget: 0, currency: 'CNY' },
        message: `${deviceLabel(deviceId.value)} 与云端合并${merged.conflicts.length ? `，${merged.conflicts.length} 处待裁决` : '，无冲突'}`,
        synced: true,
      };

      const canonical = serializeWorld(merged.world);
      cloud.value = {
        canonical,
        bundles: dedupeBundles([...freshCloud.bundles, ...syncedEdits, mergeBundle]),
        conflicts: mergeConflicts(freshCloud.conflicts, merged.conflicts),
        version: freshCloud.version + 1,
        updated_at: nowIso(),
      };
      persistCloud();

      // 本机基准推进到裁决结果；分叉包历史留在云端
      log.base = canonical;
      log.pending = [];
      log.tip_id = null;
      persistDevice();

      lastSyncAt.value = nowIso();
      if (merged.conflicts.length) toast.warn(messages.conflictPending.replace('{n}', String(merged.conflicts.length)));
      else toast.ok(messages.synced);
    } finally {
      busy.value = false;
      if (flushQueued) {
        flushQueued = false;
        if (logs.value[deviceId.value]?.pending.length) syncRound();
      }
    }
  }

  function dedupeBundles(bundles: SyncBundle[]) {
    const seen = new Set<string>();
    return bundles.filter((bundle) => {
      if (seen.has(bundle.id)) return false;
      seen.add(bundle.id);
      return true;
    });
  }

  function mergeConflicts(existing: PendingConflict[], incoming: PendingConflict[]) {
    const keys = new Set(existing.map((item) => item.slot_key));
    const merged = [...existing];
    incoming.forEach((conflict) => {
      // 同一时段槽位只留一份待选，避免重复同步刷出多条
      if (!keys.has(conflict.slot_key)) {
        keys.add(conflict.slot_key);
        merged.push(conflict);
      }
    });
    return merged;
  }

  // —— 裁决：选 a / 选 b / 两份都要（b 顺延到下一个空档） ——
  async function resolveConflict(conflictId: string, choice: 'a' | 'b' | 'both') {
    const index = cloud.value.conflicts.findIndex((item) => item.id === conflictId);
    if (index < 0) return;
    const conflict = cloud.value.conflicts[index];
    const opsToApply: BundleOp[] = [];
    if (choice === 'a' && conflict.op_a) opsToApply.push(conflict.op_a);
    if (choice === 'b' && conflict.op_b) opsToApply.push(conflict.op_b);
    if (choice === 'both') {
      if (conflict.op_a) opsToApply.push(conflict.op_a);
      if (conflict.op_b) {
        opsToApply.push(shiftChoiceLater(conflict.op_b, conflict.slot));
      }
    }
    const nextWorld = applyOps(deserializeWorld(cloud.value.canonical), opsToApply);
    const resolution: SyncBundle = {
      id: newId('resolution'),
      kind: 'resolution',
      trip_id: conflict.trip_id,
      parent_id: null,
      device_id: deviceId.value,
      created_at: nowIso(),
      ops: opsToApply,
      snapshot: { start_date: '', end_date: '', budget: 0, currency: 'CNY' },
      message: `已裁决：${conflict.title}（${choice === 'both' ? '两份都留' : choice === 'a' ? conflict.choices[0].label : conflict.choices[1].label}）`,
      synced: true,
    };
    cloud.value = {
      ...cloud.value,
      canonical: serializeWorld(nextWorld),
      bundles: [...cloud.value.bundles, resolution],
      conflicts: cloud.value.conflicts.map((item, idx) =>
        idx === index ? { ...item, resolved_choice: choice, resolved_at: nowIso() } : item),
      version: cloud.value.version + 1,
      updated_at: nowIso(),
    };
    persistCloud();
    // 把裁决结果也推进本机基准，避免本地缓存与裁决结果打架
    const log = logs.value[deviceId.value];
    if (log && !log.pending.length) {
      log.base = JSON.parse(JSON.stringify(cloud.value.canonical));
      persistDevice();
    }
    toast.ok(messages.conflictResolved);
  }

  function shiftChoiceLater(op: BundleOp, slot: string): BundleOp {
    // "两份都留"：第二份顺延 30 分钟（仅对可顺延的条目安排）
    if (op.kind === 'item-upsert') {
      const shift = 30;
      const toMin = (value: string) => {
        const [h, m] = value.split(':').map(Number);
        return h * 60 + m;
      };
      const fmt = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      return {
        ...op,
        item: {
          ...op.item,
          id: op.item.id + '-kept-b',
          start_time: fmt(toMin(op.item.start_time) + shift),
          end_time: fmt(toMin(op.item.end_time) + shift),
        },
      };
    }
    // trip 字段 / 删除类冲突"两份都要"没有语义，按选 b 处理
    void slot;
    return op;
  }

  // —— 设备与网络 ——
  function setDevice(next: SyncDeviceId) {
    if (next === deviceId.value) return;
    deviceId.value = next;
    sessionStorage.setItem('tripweaver-device', next);
    const log = ensureDevice(next);
    // 切到一台没有未提交分叉的设备时，先把它的基准推进到最新裁决结果，
    // 避免拿陈旧基准去做后续三方合并
    if (!log.pending.length && online.value) {
      log.base = JSON.parse(JSON.stringify(cloud.value.canonical));
      persistDevice();
    }
    if (online.value) syncRound();
  }
  function setOnline(value: boolean) {
    online.value = value;
    if (value) {
      toast.ok(messages.reconnected);
      syncRound();
    } else {
      toast.warn(messages.offlineMode);
    }
  }
  function refreshFromCloud() {
    const freshCloud = syncApi.loadCloud();
    if (freshCloud) cloud.value = freshCloud;
  }

  // —— 空间整理 ——
  async function runCompaction() {
    const tipIds = Object.values(logs.value).map((log) => log.tip_id).filter(Boolean) as string[];
    const result = await compactOldest({
      cloud: cloud.value,
      packs: packs.value,
      deviceTipIds: tipIds,
      baselineWorld: cloud.value.canonical,
    });
    if (!result.pack) {
      compactionReport.value = messages.compactionProtected;
      return;
    }
    cloud.value = result.cloud;
    packs.value = [...packs.value, result.pack];
    syncApi.savePacks(packs.value);
    persistCloud();
    compactionReport.value = messages.compactionDone
      .replace('{n}', String(result.packedIds.length))
      .replace('{bytes}', String(Math.round(result.freedBytes / 1024)));
  }
  const storageRatio = ref(syncApi.usageRatio());
  function refreshUsage() { storageRatio.value = syncApi.usageRatio(); }
  const pressureHigh = computed(() => storageRatio.value >= STORAGE_PRESSURE_RATIO);

  // 存储事件：其他标签（另一台设备视图）写入后，自动拉取
  function bindStorageEvents() {
    window.addEventListener('storage', (event) => {
      if (!event.key) return;
      if (event.key.includes(':cloud:') && online.value) refreshFromCloud();
      refreshUsage();
    });
    syncApi.onPressure(() => {
      void runCompaction();
      refreshUsage();
    });
  }

  // 初始化：恢复会话设备、装载云端、确保本机分叉链
  function init() {
    const sessionDevice = sessionStorage.getItem('tripweaver-device') as SyncDeviceId | null;
    if (sessionDevice && SYNC_DEVICES.some((item) => item.id === sessionDevice)) deviceId.value = sessionDevice;
    const storedCloud = syncApi.loadCloud();
    if (storedCloud) cloud.value = storedCloud;
    ensureDevice(deviceId.value);
    if (online.value) syncRound();
    bindStorageEvents();
    refreshUsage();
  }

  function dayPlansOf(tripId: string) {
    return worldDays(activeWorld.value, tripId);
  }

  return {
    // state
    deviceId, online, cloud, packs, lastSyncAt, busy, compactionReport, storageRatio, pressureHigh,
    SYNC_DEVICES,
    // getters
    canonicalWorld, localWorld, activeWorld, trips, dayPlans,
    pendingBundles, pendingCount, unresolvedConflicts, unresolvedCount, allConflicts,
    // actions
    init, appendEdit, syncRound, resolveConflict,
    setDevice, setOnline, refreshFromCloud,
    runCompaction, refreshUsage, dayPlansOf,
  };
});
