/**
 * 当前本地数据信封版本。
 * v1 -> v2：实体数据形状未变，新增分叉包/重联结果；旧信封读出后由 api 层迁移。
 * 注意：trips/spots/dayPlans 的物理键保持 v1 键名不变，这样老用户数据才能被回填读取。
 */
export const STORAGE_VERSION = 'tripweaver-v2';

const LEGACY_KEY = 'tripweaver-v1';

export const STORAGE_KEYS = {
  trips: `${LEGACY_KEY}:trips`,
  spots: `${LEGACY_KEY}:spots`,
  dayPlans: `${LEGACY_KEY}:dayPlans`,
  theme: `${LEGACY_KEY}:theme`,
};
