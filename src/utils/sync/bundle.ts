import type { BundleBaseline, ChangeBundle, ChangeOp, DeviceLabel, ItemPatch, SyncEntityName } from '../../models/sync';
import { BUNDLE_STATUS } from '../../constants/sync';

export function newBundle(deviceId: string, deviceLabel: DeviceLabel, baseRev: string, baseline: BundleBaseline = { trips: {}, dayPlans: {} }): ChangeBundle {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    deviceId,
    deviceLabel,
    parentId: null,
    baseRev,
    status: BUNDLE_STATUS.DRAFT,
    locked: false,
    createdAt: now,
    updatedAt: now,
    dates: [],
    amount: 0,
    ops: [],
    baseline,
  };
}

/** 金额取条目关联金额，没有则 0；一次落笔的金额为各 op 金额之和（去符号由调用方给） */
export function appendOp(bundle: ChangeBundle, op: ChangeOp) {
  bundle.ops.push(op);
  bundle.dates = [...new Set([...bundle.dates, op.onDate])].sort();
  bundle.amount += op.amount;
  bundle.updatedAt = new Date().toISOString();
}

/** 为分叉包记住触碰实体的基准快照（三路合并的 base） */
export function captureBaseline(
  baseline: BundleBaseline,
  entity: SyncEntityName,
  entityId: string,
  snapshot: Record<string, unknown> | undefined,
) {
  if (!snapshot) return;
  const bucket = entity === 'trips' ? baseline.trips : baseline.dayPlans;
  if (!bucket[entityId]) {
    const copy = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
    bucket[entityId] = copy;
  }
}

export function ensureItemPatch(item: Partial<ItemPatch> & Pick<ItemPatch, 'spot_id'>): ItemPatch {
  return {
    spot_id: item.spot_id,
    start_time: item.start_time || '10:00',
    end_time: item.end_time || '12:00',
    note: item.note ?? '',
    transport: item.transport ?? 'metro',
  };
}

/**
 * 把最旧的未锁定已合并包压缩成检查点：
 * ops 折叠为单条摘要，仅保留出处（设备/日期/金额）供裁决与展示。
 * 规则要求：当前编辑包（draft）和出发基准包（locked=true）永远不压。
 */
export function compactBundle(bundle: ChangeBundle): ChangeBundle {
  const folded: ChangeBundle = {
    ...bundle,
    status: BUNDLE_STATUS.CHECKPOINT,
    checkpointOf: bundle.id,
    compactedAt: new Date().toISOString(),
    ops: [],
  };
  return folded;
}

/** 候选排序：越旧越先被压；草稿包与锁定包永不参与 */
export function compactCandidates(bundles: ChangeBundle[]): ChangeBundle[] {
  return bundles
    .filter((bundle) => !bundle.locked && bundle.status !== BUNDLE_STATUS.DRAFT)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
