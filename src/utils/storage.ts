import Dexie, { type Table } from 'dexie';
import { STORAGE_VERSION } from '../constants/storageVersion';
import { LEGACY_STORAGE_VERSIONS } from '../constants/sync';
import { messages } from '../constants/messages';

class TripWeaverDb extends Dexie {
  trips!: Table<unknown, string>;
  spots!: Table<unknown, string>;
  dayPlans!: Table<unknown, string>;
  constructor() {
    super('tripweaver');
    this.version(1).stores({ trips: 'id,status,destination', spots: 'id,category', dayPlans: 'id,trip_id,day_index' });
  }
}

export const db = new TripWeaverDb();

// 记录一次"存储即将写满"的事件，供分叉包整理器消费
export type StoragePressureListener = (ratio: number) => void;
const pressureListeners = new Set<StoragePressureListener>();
export function onStoragePressure(listener: StoragePressureListener) {
  pressureListeners.add(listener);
  return () => pressureListeners.delete(listener);
}
function emitPressure(ratio: number) {
  pressureListeners.forEach((listener) => listener(ratio));
}

// 粗估 localStorage 配额占用比（Chrome 约 5MB）；navigator.storage 主要给 IndexedDB 用
export function storageUsageRatio(): number {
  try {
    let used = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) used += key.length + (localStorage.getItem(key)?.length || 0);
    }
    // UTF-16 存儲按 2 字节计，5MB 配额
    return (used * 2) / (5 * 1024 * 1024);
  } catch {
    return 0;
  }
}

// 旧数据缺版本/版本不符时：不丢弃，读出裸数据交给上层回填
export function loadRaw<T>(key: string): { data: T; version: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 兼容 { version, data } 包裹与更早的裸数组/裸对象
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return { data: parsed.data as T, version: String(parsed.version ?? '') };
    }
    return { data: parsed as T, version: '' };
  } catch {
    return null;
  }
}

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed.version === STORAGE_VERSION ? (parsed.data as T) : fallback;
  } catch {
    console.warn(messages.storageRecovered);
    return fallback;
  }
}

// 是否属于"缺版本先回填"的旧数据
export function isLegacyPayload(version: string) {
  return !version || LEGACY_STORAGE_VERSIONS.includes(version);
}

export function saveLocal<T>(key: string, data: T) {
  const write = () => localStorage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, data, updatedAt: new Date().toISOString() }));
  try {
    write();
  } catch (error) {
    // 空间紧张：广播压力事件，整理器压完最旧未锁定包后重试一次
    emitPressure(1);
    try {
      write();
    } catch (retryError) {
      console.warn(messages.storagePressureSaveFailed);
      throw retryError;
    }
  }
  const ratio = storageUsageRatio();
  if (ratio > 0.85) emitPressure(ratio);
}

// 仅供分叉包层使用：不触发递归整理、可写任意包裹格式
export function writeRawKey(key: string, value: string) {
  localStorage.setItem(key, value);
}
export function removeRawKey(key: string) {
  localStorage.removeItem(key);
}
