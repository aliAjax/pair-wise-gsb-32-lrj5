import Dexie, { type Table } from 'dexie';
import { STORAGE_VERSION } from '../constants/storageVersion';
import { messages } from '../constants/messages';
import { SYNC_SCHEMA_VERSION } from '../constants/sync';
import type { ChangeBundle } from '../models/sync';

export const STORAGE_META_KEY = 'tripweaver:meta';

interface VersionEnvelope<T> {
  version: string;
  data: T;
  updatedAt?: string;
  backfilledAt?: string;
}

interface StorageMeta {
  backfilledLegacy?: boolean;
}

class TripWeaverDb extends Dexie {
  trips!: Table<unknown, string>;
  spots!: Table<unknown, string>;
  dayPlans!: Table<unknown, string>;
  /** 本机产生的分叉包 */
  bundles!: Table<ChangeBundle, string>;
  /** 模拟“网络恢复后”对端（家人另一台设备）同步过来的分叉包 */
  remoteBundles!: Table<ChangeBundle, string>;
  constructor() {
    super('tripweaver');
    this.version(1).stores({
      trips: 'id,status,destination',
      spots: 'id,category',
      dayPlans: 'id,trip_id,day_index',
    });
    this.version(2).stores({
      trips: 'id,status,destination',
      spots: 'id,category',
      dayPlans: 'id,trip_id,day_index',
      bundles: 'id,deviceId,status,createdAt,baseRev',
      remoteBundles: 'id,deviceId,status,createdAt,baseRev',
    });
  }
}

export const db = new TripWeaverDb();

export function readStorageMeta(): StorageMeta {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_META_KEY) || '{}') as StorageMeta;
  } catch {
    return {};
  }
}

export function writeStorageMeta(meta: StorageMeta) {
  localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
}

function isEnvelope<T>(raw: unknown): raw is VersionEnvelope<T> {
  return typeof raw === 'object' && raw !== null && 'version' in raw && 'data' in raw;
}

/**
 * 旧数据缺版本先回填：
 * 1. 没有版本信封（裸数组）的旧数据，先按 tripweaver-v1 回填；
 * 2. v1 信封原样读出交给调用方做迁移。
 * 返回 { data, legacy } —— legacy=true 表示本次读到的是被回填的老数据。
 */
export function loadLocal<T>(key: string, fallback: T): { data: T; legacy: boolean } {
  try {
    const rawText = localStorage.getItem(key);
    if (rawText === null) return { data: fallback, legacy: false };
    const raw = JSON.parse(rawText);
    if (isEnvelope<T>(raw)) {
      if (raw.version === STORAGE_VERSION) return { data: raw.data as T, legacy: false };
      // 旧版本信封：交给迁移层（这里 v1->v2 数据形状兼容，直接取 data）
      return { data: raw.data as T, legacy: true };
    }
    // 无版本信封的史前数据：先回填为 v1 再继续
    const backfilled = raw as T;
    localStorage.setItem(
      key,
      JSON.stringify({ version: 'tripweaver-v1', data: backfilled, backfilledAt: new Date().toISOString() } satisfies VersionEnvelope<T>),
    );
    console.warn(messages.legacyBackfilled);
    return { data: backfilled, legacy: true };
  } catch {
    console.warn(messages.storageRecovered);
    return { data: fallback, legacy: false };
  }
}

export function saveLocal<T>(key: string, data: T) {
  const envelope: VersionEnvelope<T> = { version: STORAGE_VERSION, data, updatedAt: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify(envelope));
}

export { SYNC_SCHEMA_VERSION };
