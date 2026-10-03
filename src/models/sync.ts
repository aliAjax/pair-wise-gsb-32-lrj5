// 可续作分叉包（fork bundle）数据模型
// 每次"落笔保存"都会生成一个 bundle：记住基准（parent_id）、日期与金额快照，
// 断网时照常追加，网络恢复后按 DAG 合并。

import type { DayPlanItem } from './dayPlan';

// —— 一次保存里包含的原子改动 ——
export type BundleOp =
  // 旅行级改动：title/destination/status/日期/金额（记住日期和金额）
  | { kind: 'trip-upsert'; tripId: string; fields: Partial<BundleTripFields> }
  | { kind: 'trip-remove'; tripId: string }
  // 某天：新增一天 / 修改当天日期
  | { kind: 'day-upsert'; tripId: string; dayId: string; dayIndex: number; fields: Partial<{ date: string }> }
  | { kind: 'day-remove'; tripId: string; dayId: string }
  // 当天条目：加入景点、改时段、改交通、删除、改备注
  | { kind: 'item-upsert'; tripId: string; dayId: string; item: DayPlanItem }
  | { kind: 'item-remove'; tripId: string; dayId: string; itemId: string }
  // 同一天的顺序调整（拖拽排序）
  | { kind: 'order'; tripId: string; dayId: string; itemIds: string[] };

export interface BundleTripFields {
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget: number;
  currency: string;
  members: string[];
  status: string;
}

export type BundleKind = 'baseline' | 'edit' | 'merge' | 'resolution';

export interface SyncBundle {
  id: string;
  kind: BundleKind;
  trip_id: string;
  // 基准包（分叉点）
  parent_id: string | null;
  // 合并包/裁决包有两个父：本地基准与远端基准
  parent_ids?: string[];
  device_id: string;
  created_at: string;
  ops: BundleOp[];
  // 保存瞬间的金额与日期快照（"记住基准、日期和金额"）
  snapshot: {
    start_date: string;
    end_date: string;
    budget: number;
    currency: string;
  };
  message: string;
  locked?: boolean;
  // 已被合并包吸收（内容进入 canonical），分叉包本身仍保留为续作历史
  absorbed?: boolean;
  // 空间整理：该包已压入某个 checkpoint 压缩包，ops 已清空
  packed_in?: string;
  // 云端已存在该包（离线编辑时为 false，恢复网络后推送）
  synced?: boolean;
}

// 同一时段冲突：两份候选留待人工裁决
export type ConflictSlotType = 'trip' | 'day' | 'item' | 'order';

export interface ConflictChoice {
  label: string;
  device_id: string;
  bundle_id: string;
}

export interface PendingConflict {
  id: string;
  trip_id: string;
  day_id?: string;
  slot: ConflictSlotType;
  slot_key: string;
  title: string;
  // 两份待选（同一时段两个分叉各一份）
  choices: [ConflictChoice, ConflictChoice];
  created_at: string;
  resolved_choice?: 'a' | 'b' | 'both';
  // 关联的两个原始操作（裁决时重放胜选方）
  op_a?: BundleOp;
  op_b?: BundleOp;
  resolved_at?: string;
}

// 空间压力下生成的 checkpoint 压缩包
export interface SnapshotPack {
  id: string;
  trip_id: string;
  device_id: string;
  anchor_bundle_id: string;
  created_at: string;
  encoding: 'json' | 'gzip';
  // 压缩后的完整快照（trips/dayPlans），projection 时从这里解压续作
  payload: string;
  packed_bundle_ids: string[];
}

// projection（按分叉包日志重放出的当前世界）
export interface ProjectionResult {
  trips: import('./trip').Trip[];
  dayPlans: import('./dayPlan').DayPlan[];
}
