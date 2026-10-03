export const STORAGE_VERSION = 'tripweaver-v2';
export const STORAGE_KEYS = {
  trips: STORAGE_VERSION + ':trips',
  spots: STORAGE_VERSION + ':spots',
  dayPlans: STORAGE_VERSION + ':dayPlans',
  theme: STORAGE_VERSION + ':theme',
  // v1 旧键：旧数据缺版本时从这里回填
  legacyTrips: 'tripweaver-v1:trips',
  legacySpots: 'tripweaver-v1:spots',
  legacyDayPlans: 'tripweaver-v1:dayPlans',
};
