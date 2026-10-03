import type { CHANGE_KIND, BUNDLE_STATUS, CONFLICT_REASON } from '../constants/sync';

export type ChangeKind = (typeof CHANGE_KIND)[keyof typeof CHANGE_KIND];
export type BundleStatus = (typeof BUNDLE_STATUS)[keyof typeof BUNDLE_STATUS];
export type ConflictReason = (typeof CONFLICT_REASON)[keyof typeof CONFLICT_REASON];
export type DeviceLabel = '手机' | '车载浏览器';

export type SyncEntityName = 'trips' | 'dayPlans';

export type DayPlanTransport = 'walk' | 'metro' | 'taxi' | 'train';

export interface ItemPatch {
  spot_id: string;
  start_time: string;
  end_time: string;
  note?: string;
  transport?: DayPlanTransport;
}

/** 分叉时被触碰实体的基准快照（三路合并用：基准 / 当前 / 对方） */
export interface BundleBaseline {
  trips: Record<string, Record<string, unknown>>;
  dayPlans: Record<string, Record<string, unknown>>;
}

/** 一次“落笔”：对一次出游数据的最小可续作变更 */
export type ChangeOp =
  | {
      kind: typeof CHANGE_KIND.ENTITY_UPSERT;
      entity: SyncEntityName;
      entityId: string;
      /** 字段级补丁；三路合并时以字段为粒度比对 */
      patch: Record<string, unknown>;
      /** 顺手记录本次落笔时的日期与金额，合并/裁决时直接可读 */
      onDate: string;
      amount: number;
    }
  | {
      kind: typeof CHANGE_KIND.ENTITY_REMOVE;
      entity: SyncEntityName;
      entityId: string;
      onDate: string;
      amount: number;
    }
  | {
      kind: typeof CHANGE_KIND.ITEM_UPSERT | typeof CHANGE_KIND.ITEM_REMOVE;
      entity: 'dayPlans';
      entityId: string;
      tripId: string;
      dayIndex: number;
      date: string;
      item: ItemPatch;
      onDate: string;
      amount: number;
    }
  | {
      kind: typeof CHANGE_KIND.RESOLUTION;
      conflictId: string;
      /** 裁决选中的候选所在的包 */
      chosenBundleId: string;
      /** 被放弃的候选所在的包（仅记录，不参与展示） */
      droppedBundleId: string;
      onDate: string;
      amount: number;
    };

/**
 * 分叉包：一次离线/在线编辑会话落笔的全部变更。
 * baseRev 记住分叉基准，parentId 串起同设备续作链。
 */
export interface ChangeBundle {
  id: string;
  deviceId: string;
  deviceLabel: DeviceLabel;
  parentId: string | null;
  /** 分叉时基准重联结果的版本号 */
  baseRev: string;
  status: BundleStatus;
  /** 出发基准包 / 当前编辑包锁定，空间紧张时不压缩 */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  /** 本次落笔涉及的日期与金额快照（需求：记住基准、日期和金额） */
  dates: string[];
  amount: number;
  ops: ChangeOp[];
  /** 分叉基准快照：只记录本包触碰过的实体 */
  baseline: BundleBaseline;
  /** 被压缩成检查点后，原始 ops 折叠为摘要 */
  checkpointOf?: string;
  compactedAt?: string;
}

export interface ConflictCandidate {
  bundleId: string;
  deviceLabel: DeviceLabel;
  at: string;
  amount: number;
  /** 同一时段冲突时的候选安排 */
  item?: ItemPatch;
  /** 字段级冲突时的字段名与取值 */
  field?: string;
  value?: unknown;
}

/** 同一时段 / 同一字段打架的候选；裁决前双方都留着 */
export interface PendingConflict {
  id: string;
  tripId: string;
  dayIndex?: number;
  date: string;
  reason: ConflictReason;
  field?: string;
  candidates: ConflictCandidate[];
  createdAt: string;
  resolved: boolean;
  chosenBundleId?: string;
  resolvedAt?: string;
}

/** 重联后的唯一结果：列表、当天路线、分享页都读它 */
export interface ReconciledState {
  rev: string;
  parentRev: string;
  updatedAt: string;
  trips: Array<Record<string, unknown>>;
  dayPlans: Array<Record<string, unknown>>;
  /** 已并入该结果的分叉包 id（含顺序） */
  mergedBundleIds: string[];
  /** 尚未裁决的冲突（争议条目已从 trips/dayPlans 中摘除） */
  conflicts: PendingConflict[];
  /** 已裁决历史 */
  resolved: PendingConflict[];
  /** 值来源台账：field -> bundleId，冲突时能给出双方出处 */
  origins: Record<string, string>;
  /** 包出处摘要：bundleId -> 设备/时间/金额（压缩后仍可裁决） */
  provenance: Record<string, { deviceLabel: DeviceLabel; at: string; amount: number }>;
}
