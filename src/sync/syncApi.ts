import { CLOUD_KEYS, SYNC_KEYS } from '../constants/sync';
import { writeRawKey, removeRawKey, storageUsageRatio, onStoragePressure } from '../utils/storage';
import type { PendingConflict, SnapshotPack, SyncBundle } from '../models/sync';
import type { Trip } from '../models/trip';
import type { DayPlan } from '../models/dayPlan';
import type { World } from './world';
import { worldFromLists } from './world';

// 分叉包持久化 API。为避免 saveLocal 的压力回调把同步层自己也卷进重试，
// 这里统一走 raw key；写满时先交给整理器压缩后再重试一次。

export interface SerializedWorld {
  trips: Trip[];
  dayPlans: DayPlan[];
}

export interface DeviceLog {
  device_id: string;
  // 该设备最近一次与云端对齐时的基准世界（分叉点）
  base: SerializedWorld;
  // 断网期间尚未推送的分叉包
  pending: SyncBundle[];
  // 该设备分叉链的末端包 id（当前编辑的父）
  tip_id: string | null;
  backfilled: boolean;
}

export interface CloudState {
  // 唯一一份裁决结果：列表 / 当天路线 / 分享页都认它
  canonical: SerializedWorld;
  bundles: SyncBundle[];
  conflicts: PendingConflict[];
  version: number;
  updated_at: string;
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown, onPressure?: () => void) {
  const body = JSON.stringify(value);
  try {
    writeRawKey(key, body);
  } catch {
    onPressure?.();
    writeRawKey(key, body); // 整理器压过最旧包后重试，仍失败则向上抛
  }
}

export const syncApi = {
  deviceKey: SYNC_KEYS.bundles,
  loadDevice(deviceId: string): DeviceLog | null {
    return readJSON<DeviceLog>(SYNC_KEYS.bundles(deviceId));
  },
  saveDevice(deviceId: string, log: DeviceLog, onPressure?: () => void) {
    writeJSON(SYNC_KEYS.bundles(deviceId), log, onPressure);
  },
  loadCloud(): CloudState | null {
    return readJSON<CloudState>(CLOUD_KEYS.bundles);
  },
  saveCloud(cloud: CloudState, onPressure?: () => void) {
    writeJSON(CLOUD_KEYS.bundles, cloud, onPressure);
  },
  loadConflicts(): PendingConflict[] {
    return readJSON<PendingConflict[]>(CLOUD_KEYS.conflicts) || [];
  },
  saveConflicts(conflicts: PendingConflict[], onPressure?: () => void) {
    writeJSON(CLOUD_KEYS.conflicts, conflicts, onPressure);
  },
  loadPacks(): SnapshotPack[] {
    return readJSON<SnapshotPack[]>('tripweaver-v2:packs') || [];
  },
  savePacks(packs: SnapshotPack[], onPressure?: () => void) {
    writeJSON('tripweaver-v2:packs', packs, onPressure);
  },
  isBackfilled(deviceId: string) {
    return readJSON<boolean>(SYNC_KEYS.backfilled(deviceId)) === true;
  },
  markBackfilled(deviceId: string) {
    writeRawKey(SYNC_KEYS.backfilled(deviceId), 'true');
  },
  clearDevice(deviceId: string) {
    removeRawKey(SYNC_KEYS.bundles(deviceId));
  },
  usageRatio: storageUsageRatio,
  onPressure: onStoragePressure,
};

export function serializeWorld(world: World): SerializedWorld {
  return { trips: JSON.parse(JSON.stringify(Object.values(world.trips))), dayPlans: JSON.parse(JSON.stringify(Object.values(world.days))) };
}

export function deserializeWorld(serialized: SerializedWorld | null | undefined): World {
  if (!serialized) return worldFromLists([], []);
  return worldFromLists(serialized.trips || [], serialized.dayPlans || []);
}
