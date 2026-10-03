// 可续作分叉包（fork bundle）相关常量：键名、设备、空间阈值

export const SYNC_STORAGE_VERSION = 'tripweaver-v2';

// v1 -> v2：旧数据缺版本/版本号偏旧时先回填为分叉包基线
export const LEGACY_STORAGE_VERSIONS = ['tripweaver-v1'];

export const SYNC_KEYS = {
  // 每个"设备（手机/车机浏览器）"各自维护一份本地分叉包日志
  bundles: (deviceId: string) => `${SYNC_STORAGE_VERSION}:${deviceId}:bundles`,
  // 待裁决冲突（同一时段两份候选）也按设备本地保存，恢复网络后上云
  conflicts: (deviceId: string) => `${SYNC_STORAGE_VERSION}:${deviceId}:conflicts`,
  // 本地设备身份：手机 / 车机浏览器。仅保存在当前标签会话里，方便双开演示
  device: SYNC_STORAGE_VERSION + ':device-session',
  // 已完成回填标记，避免旧数据被重复灌成基线
  backfilled: (deviceId: string) => `${SYNC_STORAGE_VERSION}:${deviceId}:backfilled`,
};

// 云端（同浏览器内模拟家人间共享通道）使用的键
export const CLOUD_KEYS = {
  bundles: SYNC_STORAGE_VERSION + ':cloud:bundles',
  conflicts: SYNC_STORAGE_VERSION + ':cloud:conflicts',
};

// 预置两台家人设备：手机 / 车上浏览器
export const SYNC_DEVICES = [
  { id: 'phone', label: '家人手机' },
  { id: 'car', label: '车上浏览器' },
] as const;
export type SyncDeviceId = (typeof SYNC_DEVICES)[number]['id'];
export const DEFAULT_SYNC_DEVICE: SyncDeviceId = 'phone';

// 空间压力阈值：估算占用超过 85% 时先压最旧未锁定包
export const STORAGE_PRESSURE_RATIO = 0.85;
// 同一时段冲突的两份候选若选择"两份都留"，第二份顺延的分钟数
export const CONFLICT_KEEP_BOTH_SHIFT_MINUTES = 30;
