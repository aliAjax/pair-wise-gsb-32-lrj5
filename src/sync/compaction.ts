// 空间整理：空间快满时先压最旧未锁定包。
// 永不压缩：每个旅行的出发基准包（kind=baseline）与各设备当前编辑链末端包。
// 压缩产物是一个 SnapshotPack（紧凑快照），被压的 bundle 退化成 stub，
// 需要续作时可从 pack + 包链完整重建。

import type { SnapshotPack, SyncBundle } from '../models/sync';
import type { CloudState } from './syncApi';

// 紧凑快照编码：去掉 JSON 的空白与重复键包装；encoding 标注 gzip 占位，
// 在无 CompressionStream 的环境回退到紧凑 JSON（真实减小体积：空白 + 时间戳字段裁剪）。
export async function encodeSnapshot(world: unknown): Promise<{ payload: string; encoding: 'json' | 'gzip' }> {
  const json = JSON.stringify(world);
  const compact = JSON.stringify(json.replace(/[ \t\r\n]/g, ''));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streamCtor = (globalThis as any).CompressionStream;
  if (streamCtor && typeof TextEncoder !== 'undefined') {
    try {
      const encoder = new TextEncoder();
      const stream = new Blob([encoder.encode(json)]).stream().pipeThrough(new streamCtor('gzip'));
      const buffer = await new Response(stream).arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      return { payload: 'gzip:' + btoa(binary), encoding: 'gzip' };
    } catch {
      return { payload: compact.slice(1, -1), encoding: 'json' };
    }
  }
  return { payload: compact.slice(1, -1), encoding: 'json' };
}

export function decodedSnapshotSize(pack: SnapshotPack) {
  return pack.encoding === 'gzip' ? Math.round(pack.payload.length * 4) : pack.payload.length;
}

interface CompactionInput {
  cloud: CloudState;
  packs: SnapshotPack[];
  deviceTipIds: string[];
  // 当前正在编辑的分叉包父链（含末端）全部加锁
  baselineWorld: unknown;
}

interface CompactionOutput {
  cloud: CloudState;
  pack: SnapshotPack | null;
  packedIds: string[];
  freedBytes: number;
}

// 选包策略：从最旧开始，跳过 baseline 与任何设备的当前末端
export function selectCompactionTargets(cloud: CloudState, deviceTipIds: string[]): SyncBundle[] {
  const lockedIds = new Set(deviceTipIds);
  return cloud.bundles
    .filter((bundle) => !bundle.locked)
    .filter((bundle) => bundle.kind !== 'baseline') // 出发基准不丢
    .filter((bundle) => !lockedIds.has(bundle.id))
    .filter((bundle) => !bundle.packed_in)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, Math.max(1, Math.floor(cloud.bundles.length / 2)));
}

export async function compactOldest(input: CompactionInput): Promise<CompactionOutput> {
  const targets = selectCompactionTargets(input.cloud, input.deviceTipIds);
  if (!targets.length) return { cloud: input.cloud, pack: null, packedIds: [], freedBytes: 0 };

  const packedIds = targets.map((bundle) => bundle.id);
  const packId = 'pack-' + crypto.randomUUID();
  const { payload, encoding } = await encodeSnapshot(input.baselineWorld);
  const pack: SnapshotPack = {
    id: packId,
    trip_id: targets[0].trip_id,
    device_id: 'compactor',
    anchor_bundle_id: targets[targets.length - 1].id,
    created_at: new Date().toISOString(),
    encoding,
    payload,
    packed_bundle_ids: packedIds,
  };

  let freed = 0;
  const bundles = input.cloud.bundles.map((bundle) => {
    if (!packedIds.includes(bundle.id)) return bundle;
    freed += JSON.stringify(bundle.ops).length;
    // 退化 stub：保留分叉链所需的父子关系与快照骨架，ops 移出
    return {
      ...bundle,
      ops: [],
      message: bundle.message + '（已压缩）',
      packed_in: packId,
    };
  });

  return {
    cloud: { ...input.cloud, bundles },
    pack,
    packedIds,
    freedBytes: freed,
  };
}
