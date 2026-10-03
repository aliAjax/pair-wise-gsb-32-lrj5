import { db } from '../utils/storage';
import { QUOTA_WATERMARK } from '../constants/sync';
import type { ChangeBundle } from '../models/sync';

export const bundleApi = {
  async listLocal(): Promise<ChangeBundle[]> {
    return db.bundles.orderBy('createdAt').toArray() as Promise<ChangeBundle[]>;
  },
  async listRemote(): Promise<ChangeBundle[]> {
    return db.remoteBundles.orderBy('createdAt').toArray() as Promise<ChangeBundle[]>;
  },
  /** IndexedDB 的结构化克隆不接受 Vue 响应式 Proxy，落盘前转纯对象 */
  async putLocal(bundle: ChangeBundle) {
    await db.bundles.put(toPlain(bundle));
  },
  async putRemote(bundle: ChangeBundle) {
    await db.remoteBundles.put(toPlain(bundle));
  },
  async bulkPutLocal(bundles: ChangeBundle[]) {
    await db.bundles.bulkPut(bundles.map(toPlain));
  },
  async bulkPutRemote(bundles: ChangeBundle[]) {
    await db.remoteBundles.bulkPut(bundles.map(toPlain));
  },
  async removeLocal(id: string) {
    await db.bundles.delete(id);
  },
  async removeRemote(id: string) {
    await db.remoteBundles.delete(id);
  },
};

const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export interface QuotaSnapshot {
  usage: number;
  quota: number;
  ratio: number;
  nearFull: boolean;
}

export async function quotaSnapshot(): Promise<QuotaSnapshot> {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0, ratio: 0, nearFull: false };
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage || 0;
  const quota = estimate.quota || 0;
  const ratio = quota > 0 ? usage / quota : 0;
  return { usage, quota, ratio, nearFull: ratio >= QUOTA_WATERMARK };
}

export function bundleBytes(bundle: ChangeBundle): number {
  return JSON.stringify(bundle).length;
}
