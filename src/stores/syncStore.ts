import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { BundleBaseline, ChangeBundle, ChangeOp, DeviceLabel, ItemPatch, PendingConflict, ReconciledState, SyncEntityName } from '../models/sync';
import { BUNDLE_STATUS, CHANGE_KIND, DEVICE_LABELS, SYNC_STORAGE_KEYS } from '../constants/sync';
import { bundleApi, quotaSnapshot } from '../api/syncApi';
import { tripApi } from '../api/tripApi';
import { dayPlanApi } from '../api/dayPlanApi';
import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, readStorageMeta, saveLocal, writeStorageMeta } from '../utils/storage';
import { emptyReconciled, reconcile } from '../utils/sync/merge';
import { appendOp, captureBaseline, compactBundle, compactCandidates, ensureItemPatch, newBundle } from '../utils/sync/bundle';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { today } from '../utils/sync/time';
import { dayIdOf } from '../utils/sync/ids';

export { dayIdOf };

export const useSyncStore = defineStore('sync', () => {
  const deviceId = ref<string>(localStorage.getItem(SYNC_STORAGE_KEYS.deviceId) || crypto.randomUUID());
  const deviceLabel = ref<DeviceLabel>((localStorage.getItem(SYNC_STORAGE_KEYS.deviceLabel) as DeviceLabel) || DEVICE_LABELS[0]);
  const online = ref<boolean>(navigator.onLine);
  const bundles = ref<ChangeBundle[]>([]);
  const remoteBundles = ref<ChangeBundle[]>([]);
  const reconciled = ref<ReconciledState>(emptyReconciled());
  const initialized = ref(false);
  const backfilledLegacy = ref(false);
  const pendingMessage = ref('');
  /** 显式修订号：每次落笔/合并/裁决后自增，确保 canonical 投影不依赖深层响应式时序 */
  const revision = ref(0);

  localStorage.setItem(SYNC_STORAGE_KEYS.deviceId, deviceId.value);

  /** 尚未并入重联结果的本机草稿（断网期间攒着） */
  const pendingLocalBundles = computed(() => {
    void revision.value;
    return bundles.value.filter((bundle) => !reconciled.value.mergedBundleIds.includes(bundle.id));
  });

  /**
   * 三页同读的唯一结果：
   * - 在线/已重联：直接读 reconciled（草稿落笔即重联并入）；
   * - 断网：把本机未同步草稿以非严格方式投影到基准上，照常编辑不产生冲突。
   * 网络恢复时草稿会与远端分叉一起 strict 重联，冲突由此暴露。
   */
  const canonical = computed<ReconciledState>(() => {
    void revision.value;
    if (online.value) return reconciled.value;
    return reconcile(reconciled.value, pendingLocalBundles.value, false);
  });
  const trips = computed<Record<string, unknown>[]>(() => canonical.value.trips);
  const dayPlans = computed<Record<string, unknown>[]>(() => canonical.value.dayPlans);
  const conflicts = computed<PendingConflict[]>(() => canonical.value.conflicts);

  function persistReconciled() {
    saveLocal(SYNC_STORAGE_KEYS.reconciled, reconciled.value);
  }

  async function putWithCompaction(local: boolean, bundle: ChangeBundle, attempt = 0): Promise<void> {
    const api = local ? bundleApi.putLocal : bundleApi.putRemote;
    try {
      await api(bundle);
    } catch (error) {
      // 空间紧张/配额耗尽：先压最旧未锁定包再重试
      const compacted = await compactOldest();
      if (compacted && attempt < 3) return putWithCompaction(local, bundle, attempt + 1);
      throw error;
    }
  }

  /** 打开/续上当前编辑的草稿包；草稿包锁定，空间紧张时不压 */
  function openDraft(baseline: BundleBaseline = { trips: {}, dayPlans: {} }): ChangeBundle {
    const existing = bundles.value.find((bundle) => bundle.status === BUNDLE_STATUS.DRAFT);
    if (existing) return existing;
    const draft = newBundle(deviceId.value, deviceLabel.value, reconciled.value.rev, baseline);
    draft.locked = true;
    bundles.value.unshift(draft);
    // 必须返回 reactive 数组里的代理，后续 appendOp 的深层修改才能触发更新
    return bundles.value.find((bundle) => bundle.id === draft.id)!;
  }

  function baselineSnapshot(entity: SyncEntityName, entityId: string): Record<string, unknown> | undefined {
    const state = canonical.value;
    const list = entity === 'trips' ? state.trips : state.dayPlans;
    return list.find((item) => String(item.id) === entityId);
  }

  async function record(op: ChangeOp, baseline?: { entity: SyncEntityName; entityId: string }) {
    const draft = openDraft();
    if (baseline) captureBaseline(draft.baseline, baseline.entity, baseline.entityId, baselineSnapshot(baseline.entity, baseline.entityId));
    appendOp(draft, op);
    revision.value += 1;
    await putWithCompaction(true, draft);
    if (online.value) {
      await reconcileAll();
    } else {
      pendingMessage.value = messages.bundleSavedOffline;
    }
  }

  async function recordTripCreate(trip: Record<string, unknown>) {
    const op: ChangeOp = {
      kind: CHANGE_KIND.ENTITY_UPSERT,
      entity: 'trips',
      entityId: String(trip.id),
      patch: trip,
      onDate: today(),
      amount: Number(trip.budget) || 0,
    };
    const draft = openDraft();
    appendOp(draft, op);
    // 出发基准包锁定：空间紧张时也不丢
    draft.locked = true;
    revision.value += 1;
    await putWithCompaction(true, draft);
    if (online.value) await reconcileAll();
    toast.ok(messages.baselineLocked);
  }

  async function recordTripEdit(tripId: string, patch: Record<string, unknown>) {
    const op: ChangeOp = {
      kind: CHANGE_KIND.ENTITY_UPSERT,
      entity: 'trips',
      entityId: tripId,
      patch,
      onDate: today(),
      amount: typeof patch.budget === 'number' ? patch.budget : 0,
    };
    await record(op, { entity: 'trips', entityId: tripId });
  }

  async function recordTripRemove(tripId: string) {
    const op: ChangeOp = { kind: CHANGE_KIND.ENTITY_REMOVE, entity: 'trips', entityId: tripId, onDate: today(), amount: 0 };
    await record(op);
  }

  async function recordDayItem(tripId: string, dayIndex: number, date: string, item: Partial<ItemPatch> & Pick<ItemPatch, 'spot_id'>, amount: number, remove = false) {
    const entityId = dayIdOf(tripId, dayIndex);
    const patch = ensureItemPatch(item);
    const op: ChangeOp = remove
      ? { kind: CHANGE_KIND.ITEM_REMOVE, entity: 'dayPlans', entityId, tripId, dayIndex, date, item: patch, onDate: date, amount }
      : { kind: CHANGE_KIND.ITEM_UPSERT, entity: 'dayPlans', entityId, tripId, dayIndex, date, item: patch, onDate: date, amount };
    await record(op, { entity: 'dayPlans', entityId });
  }

  async function recordReorder(tripId: string, dayIndex: number, date: string, items: ItemPatch[]) {
    // 排序不改变时间与金额：为每个落点写一条同值 upsert，对端续作时顺序仍可追
    for (const item of items) {
      const entityId = dayIdOf(tripId, dayIndex);
      const op: ChangeOp = { kind: CHANGE_KIND.ITEM_UPSERT, entity: 'dayPlans', entityId, tripId, dayIndex, date, item: ensureItemPatch(item), onDate: date, amount: 0 };
      const current = openDraft();
      captureBaseline(current.baseline, 'dayPlans', entityId, baselineSnapshot('dayPlans', entityId));
      appendOp(current, op);
    }
    revision.value += 1;
    const draft = bundles.value.find((bundle) => bundle.status === BUNDLE_STATUS.DRAFT);
    if (draft) await putWithCompaction(true, draft);
    if (online.value) await reconcileAll();
  }

  /** 网络恢复 / 手动触发：先拉取远端分叉包，再与本机草稿做三路合并 */
  async function reconcileAll() {
    // 网络恢复后拉取家人在其它设备推来的分叉包（按 id 去重合并）
    const fetched = await bundleApi.listRemote();
    for (const remote of fetched) {
      if (!remoteBundles.value.some((bundle) => bundle.id === remote.id)) remoteBundles.value.push(remote);
    }
    // 本机草稿排在前面：同一时刻落笔时，自己的安排先在位，对方的分叉再触发冲突留两份
    const all = [...bundles.value, ...remoteBundles.value];
    const before = reconciled.value.conflicts.length;
    const merged = reconcile(reconciled.value, all, true);
    const cleanMerged = merged.mergedBundleIds.length - reconciled.value.mergedBundleIds.length;
    reconciled.value = merged;
    revision.value += 1;

    // 已并入的草稿包退出“当前编辑”；出发基准包（创建旅行的包）保持锁定
    for (const bundle of bundles.value) {
      if (merged.mergedBundleIds.includes(bundle.id) && bundle.status === BUNDLE_STATUS.DRAFT) {
        const isBaseline = bundle.ops.some(
          (op) => op.kind === CHANGE_KIND.ENTITY_UPSERT && op.entity === 'trips' && 'created_at' in op.patch,
        );
        bundle.status = BUNDLE_STATUS.MERGED;
        bundle.locked = isBaseline;
        await bundleApi.putLocal(bundle);
      }
    }
    persistReconciled();

    if (cleanMerged > 0) toast.ok(messages.bundlesMergedClean);
    if (merged.conflicts.length > before) toast.warn(messages.conflictPending);
  }

  async function resolveConflict(conflictId: string, chosenBundleId: string) {
    const conflict = conflicts.value.find((item) => item.id === conflictId);
    if (!conflict || conflict.resolved) return;
    const dropped = conflict.candidates.find((candidate) => candidate.bundleId !== chosenBundleId);
    const candidate = conflict.candidates.find((item) => item.bundleId === chosenBundleId);
    const op: ChangeOp = {
      kind: CHANGE_KIND.RESOLUTION,
      conflictId,
      chosenBundleId,
      droppedBundleId: dropped?.bundleId || chosenBundleId,
      onDate: today(),
      amount: candidate?.amount || 0,
    };
    const draft = openDraft();
    appendOp(draft, op);
    await putWithCompaction(true, draft);
    await reconcileAll();
    toast.ok(messages.conflictResolved);
  }

  /** 空间紧张：压缩最旧的未锁定、未在编辑的包；当前编辑包和出发基准包不压 */
  async function compactOldest(): Promise<boolean> {
    const source = compactCandidates([...bundles.value, ...remoteBundles.value]);
    const oldest = source[0];
    if (!oldest) {
      toast.fail(messages.compactSkipped);
      return false;
    }
    const folded = compactBundle(oldest);
    const isLocal = bundles.value.some((bundle) => bundle.id === oldest.id);
    if (isLocal) {
      const index = bundles.value.findIndex((bundle) => bundle.id === oldest.id);
      bundles.value.splice(index, 1, folded);
      await bundleApi.putLocal(folded);
    } else {
      const index = remoteBundles.value.findIndex((bundle) => bundle.id === oldest.id);
      remoteBundles.value.splice(index, 1, folded);
      await bundleApi.putRemote(folded);
    }
    revision.value += 1;
    toast.warn(messages.compacted);
    return true;
  }

  async function maybeCompactByQuota() {
    const quota = await quotaSnapshot();
    if (quota.nearFull) await compactOldest();
    return quota;
  }

  async function setDeviceLabel(label: DeviceLabel) {
    deviceLabel.value = label;
    localStorage.setItem(SYNC_STORAGE_KEYS.deviceLabel, label);
  }

  async function setOnline(value: boolean) {
    online.value = value;
    if (value) await reconcileAll();
  }

  function toggleLock(bundleId: string) {
    const bundle = bundles.value.find((item) => item.id === bundleId);
    if (!bundle) return;
    bundle.locked = !bundle.locked;
    bundleApi.putLocal(bundle);
  }

  /** 模拟家人在“车载浏览器”上基于同一基准分叉；恢复网络后与本机改动相撞/合流 */
  async function simulateFamilyFork(tripId: string, dayOneDate: string, currentBudget: number) {
    const baseRev = reconciled.value.rev;
    const baseTrip = baselineSnapshot('trips', tripId) ? JSON.parse(JSON.stringify(baselineSnapshot('trips', tripId))) : {};
    const baseDayRaw = baselineSnapshot('dayPlans', dayIdOf(tripId, 1));
    const baseDay = baseDayRaw ? JSON.parse(JSON.stringify(baseDayRaw)) : undefined;

    // 本机（手机）落笔：预算改 4200
    const runId = crypto.randomUUID().slice(0, 8);
    const local = newBundle(`sim-mobile-${runId}`, '手机', baseRev, { trips: { [tripId]: baseTrip }, dayPlans: {} });
    appendOp(local, { kind: CHANGE_KIND.ENTITY_UPSERT, entity: 'trips', entityId: tripId, patch: { budget: Math.round(currentBudget * 1.3) }, onDate: today(), amount: Math.round(currentBudget * 1.3) });

    // 家人（车载浏览器）落笔：预算改 5000（字段冲突）；同一时段插一个 10:30-11:30 的安排；另在第 2 天加不冲突安排
    const remote = newBundle(`sim-car-${runId}`, '车载浏览器', baseRev, {
      trips: { [tripId]: baseTrip },
      dayPlans: baseDay ? { [dayIdOf(tripId, 1)]: baseDay } : {},
    });
    appendOp(remote, { kind: CHANGE_KIND.ENTITY_UPSERT, entity: 'trips', entityId: tripId, patch: { budget: currentBudget + 1800 }, onDate: today(), amount: currentBudget + 1800 });
    appendOp(remote, {
      kind: CHANGE_KIND.ITEM_UPSERT,
      entity: 'dayPlans',
      entityId: dayIdOf(tripId, 1),
      tripId,
      dayIndex: 1,
      date: dayOneDate,
      item: { spot_id: 'spot-park', start_time: '10:30', end_time: '11:30', note: '车上临时看到的乐园', transport: 'taxi' },
      onDate: dayOneDate,
      amount: 180,
    });
    appendOp(remote, {
      kind: CHANGE_KIND.ITEM_UPSERT,
      entity: 'dayPlans',
      entityId: dayIdOf(tripId, 2),
      tripId,
      dayIndex: 2,
      date: dayOneDate,
      item: { spot_id: 'spot-market', start_time: '18:00', end_time: '20:00', note: '不冲突的夜市安排', transport: 'metro' },
      onDate: dayOneDate,
      amount: 120,
    });

    await putWithCompaction(true, local);
    await putWithCompaction(false, remote);
    bundles.value.unshift(local);
    remoteBundles.value.unshift(remote);
    online.value = true;
    await reconcileAll();
    toast.ok(messages.forkSimulated);
  }

  async function init() {
    if (initialized.value) return;
    localStorage.setItem(SYNC_STORAGE_KEYS.deviceId, deviceId.value);

    // 旧数据缺版本：回填标记（loadLocal 内部已完成 v1 回填，这里只记录）
    const meta = readStorageMeta();
    backfilledLegacy.value = Boolean(meta.backfilledLegacy);
    if (!meta.backfilledLegacy) {
      writeStorageMeta({ ...meta, backfilledLegacy: true });
      backfilledLegacy.value = true;
    }

    const [localList, remoteList] = await Promise.all([bundleApi.listLocal(), bundleApi.listRemote()]);
    bundles.value = localList;
    remoteBundles.value = remoteList;

    const persisted = loadLocal<ReconciledState | null>(SYNC_STORAGE_KEYS.reconciled, null).data;
    reconciled.value = persisted || emptyReconciled();

    // 旧数据缺版本先回填：把 v1 的 trips/dayPlans 折叠成一个锁定的“出发基准包”并入结果
    if (!persisted) {
      const legacyTrips = tripApi.list() as unknown as Array<Record<string, unknown>>;
      const legacyDays = dayPlanApi.list() as unknown as Array<Record<string, unknown>>;
      if (legacyTrips.length || legacyDays.length) {
        const backfill = newBundle(deviceId.value, deviceLabel.value, reconciled.value.rev);
        backfill.locked = true;
        for (const trip of legacyTrips) {
          appendOp(backfill, {
            kind: CHANGE_KIND.ENTITY_UPSERT,
            entity: 'trips',
            entityId: String(trip.id),
            patch: trip,
            onDate: today(),
            amount: Number(trip.budget) || 0,
          });
        }
        for (const day of legacyDays) {
          const items = (day.items as ItemPatch[]) || [];
          for (const item of items) {
            appendOp(backfill, {
              kind: CHANGE_KIND.ITEM_UPSERT,
              entity: 'dayPlans',
              entityId: String(day.id),
              tripId: String(day.trip_id),
              dayIndex: Number(day.day_index),
              date: String(day.date || today()),
              item: ensureItemPatch(item),
              onDate: String(day.date || today()),
              amount: 0,
            });
          }
        }
        backfill.status = BUNDLE_STATUS.MERGED;
        await bundleApi.putLocal(backfill);
        bundles.value.unshift(backfill);
        reconciled.value = reconcile(emptyReconciled(), [backfill], true);
        backfilledLegacy.value = true;
        persistReconciled();
        toast.ok(messages.legacyBackfilled);
        // 回填后，旧实体数组继续作为兼容镜像保留，后续以重联结果为准
        saveLocal(STORAGE_KEYS.trips, reconciled.value.trips as never[]);
        saveLocal(STORAGE_KEYS.dayPlans, reconciled.value.dayPlans as never[]);
      }
    }

    // 已有分叉包但重联结果丢失时，用空基准重放（兜底）
    if (allBundles().length && !persisted && reconciled.value.mergedBundleIds.length === 0) {
      reconciled.value = reconcile(emptyReconciled(), allBundles(), true);
      persistReconciled();
    }

    window.addEventListener('online', () => {
      online.value = true;
      reconcileAll();
    });
    window.addEventListener('offline', () => {
      online.value = false;
      toast.warn(messages.bundleSavedOffline);
    });

    initialized.value = true;
    if (navigator.onLine) await reconcileAll();
  }

  function allBundles(): ChangeBundle[] {
    return [...bundles.value, ...remoteBundles.value];
  }

  return {
    deviceId,
    deviceLabel,
    online,
    initialized,
    backfilledLegacy,
    pendingMessage,
    bundles,
    remoteBundles,
    reconciled,
    pendingLocalBundles,
    canonical,
    trips,
    dayPlans,
    conflicts,
    init,
    recordTripCreate,
    recordTripEdit,
    recordTripRemove,
    recordDayItem,
    recordReorder,
    reconcileAll,
    resolveConflict,
    compactOldest,
    maybeCompactByQuota,
    setDeviceLabel,
    setOnline,
    toggleLock,
    simulateFamilyFork,
    dayIdOf,
  };
});
