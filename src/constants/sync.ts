import type { DeviceLabel } from '../models/sync';

/**
 * 同步 / 分叉包相关常量。
 * 与业务枚举分开：同步是横切关注点，storage、api、store、hooks 共用这一份。
 */
export const CHANGE_KIND = {
  ENTITY_UPSERT: 'entity-upsert',
  ENTITY_REMOVE: 'entity-remove',
  ITEM_UPSERT: 'item-upsert',
  ITEM_REMOVE: 'item-remove',
  RESOLUTION: 'resolution',
} as const;

export const BUNDLE_STATUS = {
  DRAFT: 'draft',
  MERGED: 'merged',
  CHECKPOINT: 'checkpoint',
} as const;

export const CONFLICT_REASON = {
  SAME_SLOT: 'same-slot',
  FIELD: 'field',
} as const;

export const SYNC_SCHEMA_VERSION = 'tripweaver-sync-v1';

export const SYNC_STORAGE_KEYS = {
  deviceId: 'tripweaver:deviceId',
  deviceLabel: 'tripweaver:deviceLabel',
  reconciled: 'tripweaver-v2:reconciled',
  backfilled: 'tripweaver-v2:backfilled',
};

export const DEVICE_LABELS: DeviceLabel[] = ['手机', '车载浏览器'];

/** 触发压缩的使用量水位（navigator.storage.estimate 不可用时仅靠写入异常兜底） */
export const QUOTA_WATERMARK = 0.85;

/** 每次落笔后草稿包自动持久化的防抖时间（毫秒） */
export const AUTOSAVE_DEBOUNCE_MS = 400;
