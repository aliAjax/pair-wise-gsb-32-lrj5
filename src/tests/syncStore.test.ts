// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { Pinia } from 'pinia';
import type { useSyncStore } from '../stores/syncStore';
import type { useTripStore } from '../stores/tripStore';
import type { useDayPlanStore } from '../stores/dayPlanStore';

vi.mock('../utils/message', () => ({
  toast: { ok: () => {}, warn: () => {}, fail: () => {} },
}));

function setupDom(storage: Record<string, string> = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const { window } = dom;
  const store = new Map(Object.entries(storage));
  const localStorageShim = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: { onLine: true, storage: { estimate: async () => ({ usage: 100, quota: 1000 }) } },
    localStorage: localStorageShim,
    indexedDB: new IDBFactory(),
    IDBKeyRange,
  });
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2, 10) }, configurable: true });
  return localStorageShim;
}

async function freshStores() {
  vi.resetModules();
  const piniaModule = await import('pinia');
  const pinia: Pinia = piniaModule.createPinia();
  const { useSyncStore: useSync } = await import('../stores/syncStore');
  const { useTripStore: useTrip } = await import('../stores/tripStore');
  const { useDayPlanStore: useDay } = await import('../stores/dayPlanStore');
  const sync = useSync(pinia) as unknown as ReturnType<typeof useSyncStore>;
  const trips = useTrip(pinia) as unknown as ReturnType<typeof useTripStore>;
  const days = useDay(pinia) as unknown as ReturnType<typeof useDayPlanStore>;
  return { pinia, sync, trips, days };
}

beforeEach(() => {
  setupDom();
});

describe('同步中枢端到端', () => {
  it('离线落笔 → 重联：不冲突的一起生效，同一时段留两份待裁决，裁决后唯一落定', async () => {
    const { sync, trips, days } = await freshStores();
    await sync.init();

    const tripId = await trips.createTrip('家庭出游');
    expect(sync.trips).toHaveLength(1);

    // 手机断网编排第 1 天 10:00-12:00
    await sync.setOnline(false);
    await days.addSpot(tripId, 'spot-westlake', 1, 0);
    expect(sync.pendingLocalBundles.length).toBeGreaterThan(0);
    expect(sync.dayPlans.find((day) => day.day_index === 1)?.items ?? []).toHaveLength(1);

    // 车载浏览器基于同一基准分叉：10:30-11:30 撞时段，另在第 2 天加不冲突安排
    const { newBundle, appendOp, ensureItemPatch } = await import('../utils/sync/bundle');
    const { CHANGE_KIND } = await import('../constants/sync');
    const { bundleApi } = await import('../api/syncApi');
    const remote = newBundle('device-car', '车载浏览器', sync.reconciled.rev);
    const day1 = sync.dayIdOf(tripId, 1);
    const day2 = sync.dayIdOf(tripId, 2);
    appendOp(remote, {
      kind: CHANGE_KIND.ITEM_UPSERT, entity: 'dayPlans', entityId: day1, tripId, dayIndex: 1,
      date: '2026-10-10', item: ensureItemPatch({ spot_id: 'spot-park', start_time: '10:30', end_time: '11:30' }),
      onDate: '2026-10-10', amount: 180,
    });
    appendOp(remote, {
      kind: CHANGE_KIND.ITEM_UPSERT, entity: 'dayPlans', entityId: day2, tripId, dayIndex: 2,
      date: '2026-10-11', item: ensureItemPatch({ spot_id: 'spot-market', start_time: '18:00', end_time: '20:00' }),
      onDate: '2026-10-11', amount: 120,
    });
    await bundleApi.putRemote(remote);
    await sync.setOnline(true);

    // 同一时段：唯一结果中两份都不在；第 2 天的安排已生效
    expect(sync.conflicts).toHaveLength(1);
    const firstDay = sync.dayPlans.find((day) => day.day_index === 1);
    expect(firstDay?.items ?? []).toHaveLength(0);
    expect(sync.dayPlans.find((day) => day.day_index === 2)?.items).toHaveLength(1);
    expect(sync.conflicts[0].candidates).toHaveLength(2);

    // 裁决：选车载浏览器的乐园
    const carCandidate = sync.conflicts[0].candidates.find((candidate) => candidate.deviceLabel === '车载浏览器')!;
    await sync.resolveConflict(sync.conflicts[0].id, carCandidate.bundleId);
    expect(sync.conflicts).toHaveLength(0);
    const settled = sync.dayPlans.find((day) => day.day_index === 1) as { items: { spot_id: string }[] } | undefined;
    expect(settled?.items).toHaveLength(1);
    expect(settled?.items[0].spot_id).toBe('spot-park');

    // 费用：裁决前 park 未计费；裁决后三页同源数据里 park(180)+market(120)
    const { calcTripCost } = await import('../utils/budgetCalculator');
    const spots = [
      { id: 'spot-park', price: 180 },
      { id: 'spot-market', price: 120 },
      { id: 'spot-westlake', price: 0 },
    ] as never[];
    const cost = calcTripCost(sync.dayPlans as never[], spots, sync.conflicts);
    expect(cost).toBe(300);
  });

  it('空间紧张：压缩最旧未锁定包；当前编辑包与出发基准包不被压', async () => {
    const { sync, trips } = await freshStores();
    await sync.init();
    const tripId = await trips.createTrip();

    // 出发基准包锁定
    const baselineLocked = sync.bundles.filter((bundle) => bundle.locked);
    expect(baselineLocked.length).toBeGreaterThan(0);

    // 在线再落笔一次 → 产生一个已合并且未锁定的旧包
    await sync.recordTripEdit(tripId, { budget: 9999 });
    const compactable = sync.bundles.find((bundle) => !bundle.locked);
    expect(compactable).toBeTruthy();
    // 断网产生当前编辑草稿（锁定）
    await sync.setOnline(false);
    await sync.recordTripEdit(tripId, { budget: 8888 });
    const draft = sync.bundles.find((bundle) => bundle.status === 'draft');
    expect(draft?.locked).toBe(true);

    const before = sync.bundles.length;
    await sync.compactOldest();
    expect(sync.bundles.length).toBe(before);
    const folded = sync.bundles.find((bundle) => bundle.status === 'checkpoint');
    expect(folded).toBeTruthy();
    expect(folded!.amount).toBeGreaterThanOrEqual(0);
    // 基准与草稿都在
    expect(sync.bundles.some((bundle) => bundle.locked && bundle.status !== 'checkpoint')).toBe(true);
    expect(sync.bundles.some((bundle) => bundle.status === 'draft')).toBe(true);
  });

  it('旧数据缺版本先回填：裸数组读入后并入重联结果', async () => {
    const storage = setupDom({
      'tripweaver-v1:trips': JSON.stringify([
        { id: 'legacy-trip', title: '老旅行', destination: '南京', budget: 2000, members: [], status: 'planning', start_date: '2026-09-01', end_date: '2026-09-03', created_at: '2026-09-01' },
      ]),
    });
    const { sync } = await freshStores();
    await sync.init();
    expect(sync.backfilledLegacy).toBe(true);
    expect(sync.trips.some((trip) => trip.id === 'legacy-trip')).toBe(true);
    // 老数据已回填为锁定的出发基准包
    expect(sync.bundles.some((bundle) => bundle.locked)).toBe(true);
    // 迁移完成后该键已按当前版本重新落信封
    expect(JSON.parse(storage.getItem('tripweaver-v1:trips')!).version).toBe('tripweaver-v2');
  });
});
