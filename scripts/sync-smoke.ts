// 分叉包同步引擎端到端冒烟测试（Node + esbuild 打包运行）
import { createPinia, setActivePinia } from 'pinia';
import { useSyncStore } from '../src/stores/syncStore';
import { useTripStore } from '../src/stores/tripStore';
import { useDayPlanStore } from '../src/stores/dayPlanStore';
import { useSpotStore } from '../src/stores/spotStore';
import { STORAGE_KEYS } from '../src/constants/storageVersion';
import { CLOUD_KEYS } from '../src/constants/sync';
import { budgetStatus, disputedItemIds } from '../src/utils/budgetCalculator';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed += 1; console.log('  ✓', label); }
  else { failed += 1; console.error('  ✗ FAIL:', label); }
}

// —— localStorage / sessionStorage / window shim ——
class MemoryStorage {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  clear() { this.map.clear(); }
}
const mem = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = mem;
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
function elStub(): any {
  const target = function () {} as any;
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'style') return new Proxy({}, { get: () => '', set: () => true });
      if (prop === 'classList') return { add() {}, remove() {}, contains: () => false };
      if (prop === 'getBoundingClientRect') return () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0, x: 0, y: 0 });
      if (['appendChild', 'removeChild', 'insertBefore', 'addEventListener', 'removeEventListener', 'setTimeout', 'focus', 'blur'].includes(String(prop))) return () => elStub();
      if (['setAttribute', 'removeAttribute', 'append'].includes(String(prop))) return () => {};
      if (prop === 'childNodes' || prop === 'children') return [];
      if (prop === 'ownerDocument') return docStub;
      return elStub();
    },
    set: () => true,
    apply: () => elStub(),
  });
}
const docStub = new Proxy({} as any, {
  get(_t, prop) {
    if (prop === 'createElement' || prop === 'createTextNode') return () => elStub();
    if (prop === 'body' || prop === 'documentElement' || prop === 'head') return elStub();
    if (['addEventListener', 'removeEventListener'].includes(String(prop))) return () => {};
    return undefined;
  },
});
(globalThis as unknown as { document: unknown }).document = docStub;
(globalThis as unknown as { window: unknown }).window = { addEventListener() {}, removeEventListener() {}, document: docStub };

async function main() {
  setActivePinia(createPinia());
  const sync = useSyncStore();
  const trips = useTripStore();
  const days = useDayPlanStore();
  const spots = useSpotStore();

  // ============ 场景 1：双端离线分叉后联网合并 ============
  console.log('\n[1] 手机端初始化（演示旅行出发基准）');
  sync.init();
  assert(sync.trips.length === 1, '首启回填/演示出 1 趟旅行');
  const tripId = sync.trips[0].id;
  const dayOne = sync.dayPlansOf(tripId)[0];
  assert(Boolean(dayOne), '有第 1 天基准');
  assert(sync.cloud.bundles.some((b) => b.kind === 'baseline' && b.locked), '出发基准包已锁定');
  const baseBudget = sync.trips[0].budget;

  console.log('\n[2] 手机断网：改金额、加 15:00 时段安排');
  sync.setOnline(false);
  trips.updateTrip(tripId, { budget: 3500 });
  days.addSpot(tripId, spots.spots[2].id, 1); // 烟火夜市，默认顺延；再改成 15:00
  {
    const d = sync.dayPlansOf(tripId).find((x) => x.day_index === 1)!;
    const added = d.items[d.items.length - 1];
    added.start_time = '15:00'; added.end_time = '16:00';
    days.upsertItem(tripId, d.id, added, '手机：15:00 夜市');
  }
  assert(sync.pendingCount === 3, '手机离线积累 3 个分叉包（改金额/加景点/改时段）');
  // 离线投影应立即反映本机改动
  assert(sync.trips[0].budget === 3500, '离线投影金额=3500（本机可见）');
  assert(JSON.parse(mem.getItem(CLOUD_KEYS.bundles)!).canonical.trips[0].budget === baseBudget, '云端仍是出发基准金额（未被覆盖）');

  console.log('\n[3] 切到车机（仍断网）：改金额为 4000、加 14:00 与 15:30 两个安排');
  sync.setDevice('car');
  assert(sync.trips[0].budget === baseBudget, '车机以云端基准分叉，看不到手机离线改动');
  trips.updateTrip(tripId, { budget: 4000 });
  days.addSpot(tripId, spots.spots[3].id, 1); // 湖滨乐园
  {
    const d = sync.dayPlansOf(tripId).find((x) => x.day_index === 1)!;
    const added = d.items[d.items.length - 1];
    added.start_time = '14:00'; added.end_time = '15:00';
    days.upsertItem(tripId, d.id, added, '车机：14:00 乐园');
  }
  days.addSpot(tripId, spots.spots[1].id, 1); // 博物馆
  {
    const d = sync.dayPlansOf(tripId).find((x) => x.day_index === 1)!;
    const added = d.items[d.items.length - 1];
    added.start_time = '15:30'; added.end_time = '16:30';
    days.upsertItem(tripId, d.id, added, '车机：15:30 博物馆');
  }

  console.log('\n[4] 车机先联网：单边分叉无冲突直接合并');
  sync.setOnline(true);
  assert(sync.trips[0].budget === 4000, '车机改动进入云端，金额=4000');
  assert(sync.unresolvedCount === 0, '车机单边合并无冲突');
  const carDay = sync.dayPlansOf(tripId).find((x) => x.day_index === 1)!;
  assert(carDay.items.some((i) => i.start_time === '14:00'), '不冲突改动（14:00 乐园）已生效');

  console.log('\n[5] 手机联网：三方合并，金额冲突 + 同一时段冲突，无冲突改动共存');
  sync.setDevice('phone');
  sync.syncRound();
  assert(sync.unresolvedCount === 2, `产生 2 处待裁决（实际 ${sync.unresolvedCount}）`);
  assert(sync.trips[0].budget === baseBudget, '冲突金额裁决前回落到基准 3200');
  const mergedDay = sync.dayPlansOf(tripId).find((x) => x.day_index === 1)!;
  assert(mergedDay.items.some((i) => i.start_time === '14:00'), '14:00 乐园（无冲突）一起生效');
  const phone1500 = mergedDay.items.find((i) => i.start_time === '15:00');
  const car1530 = mergedDay.items.find((i) => i.start_time === '15:30');
  assert(!phone1500 && !car1530, '15:00/15:30 冲突两份均挂起，不进当天路线');

  console.log('\n[6] 裁决前不计费用 / 分享冻结');
  {
    const trip = sync.trips[0];
    const disputed = disputedItemIds(sync.allConflicts, tripId);
    const status = budgetStatus(trip, [mergedDay], spots.spots, sync.allConflicts);
    assert(status.gated, '预算状态标记 gated');
    const disputedOps = sync.unresolvedConflicts.filter((c) => c.slot === 'item');
    assert(disputedOps.length === 1 && disputed.size >= 2, '两份候选条目都不计费用');
  }

  console.log('\n[7] 裁决：金额选手机(3500)，时段"两份都要"第二份顺延 30 分钟');
  {
    const budgetConflict = sync.unresolvedConflicts.find((c) => c.slot_key.includes(':field:budget'))!;
    const slotConflict = sync.unresolvedConflicts.find((c) => c.slot === 'item' && c.slot_key.includes('timeslot'))!;
    assert(Boolean(budgetConflict) && Boolean(slotConflict), '能定位两类冲突');
    await sync.resolveConflict(budgetConflict.id, 'a'); // 手机 3500
    assert(sync.trips[0].budget === 3500, '裁决后金额=3500，三处视图同源');
    await sync.resolveConflict(slotConflict.id, 'both');
    const finalDay = sync.dayPlansOf(tripId).find((x) => x.day_index === 1)!;
    assert(finalDay.items.some((i) => i.start_time === '15:00'), '第一份保留在 15:00');
    assert(finalDay.items.some((i) => i.start_time === '16:00' && i.id.endsWith('-kept-b')), '第二份顺延到 16:00 且新 id');
    assert(sync.unresolvedCount === 0, '全部裁决完成');
    const status = budgetStatus(sync.trips[0], [finalDay], spots.spots, []);
    assert(!status.gated, '裁决后费用解冻');
  }

  // ============ 场景 2：空间整理保护基准与当前编辑 ============
  console.log('\n[8] 空间压缩：最旧未锁定包被压，出发基准与当前末端不动');
  {
    sync.setDevice('phone');
    sync.setOnline(false);
    for (let i = 0; i < 6; i += 1) trips.updateTrip(tripId, { budget: 3600 + i });
    const beforeBundles = sync.cloud.bundles.length;
    await sync.runCompaction();
    const cloud = JSON.parse(mem.getItem(CLOUD_KEYS.bundles)!);
    const packs = JSON.parse(mem.getItem('tripweaver-v2:packs')!);
    assert(packs.length >= 1, '生成了 snapshot pack');
    assert(cloud.bundles.some((b: { packed_in?: string }) => b.packed_in), '最旧包退化为 stub');
    assert(cloud.bundles.filter((b: { kind: string }) => b.kind === 'baseline').every((b: { ops: unknown[] }) => b.ops.length === 0), '出发基准未被压缩');
    const tip = sync.pendingBundles[sync.pendingBundles.length - 1];
    assert(!tip.packed_in, '当前编辑末端包未被压缩');
    assert(cloud.bundles.length === beforeBundles, '包链数量不变（只清空 ops，续作历史不丢）');
    // 受保护场景：只剩基准/末端时不再压
    sync.setOnline(true);
    sync.syncRound();
  }

  // ============ 场景 3：旧数据缺版本先回填 ============
  console.log('\n[9] 清空后用 v1 旧数据首启：自动回填为分叉包基准');
  {
    mem.clear();
    const pinia2 = createPinia();
    setActivePinia(pinia2);
    const v1Trips = [{
      id: 'legacy-trip', title: '旧旅行', destination: '苏州',
      start_date: '2026-05-01', end_date: '2026-05-02', budget: 1000, currency: 'CNY',
      members: ['家人'], status: 'planning', created_at: '2026-01-01T00:00:00.000Z',
    }];
    const v1Days = [{
      id: 'legacy-day', trip_id: 'legacy-trip', day_index: 1, date: '2026-05-01',
      items: [{ spot_id: 'spot-museum', start_time: '09:00', end_time: '10:00', note: '旧', transport: 'walk' }], // 无 item.id
    }];
    mem.setItem(STORAGE_KEYS.legacyTrips, JSON.stringify({ version: 'tripweaver-v1', data: v1Trips }));
    mem.setItem(STORAGE_KEYS.legacyDayPlans, JSON.stringify({ version: 'tripweaver-v1', data: v1Days }));
    const sync2 = useSyncStore();
    sync2.init();
    const t = sync2.trips.find((x) => x.id === 'legacy-trip');
    assert(Boolean(t), 'v1 旧旅行已回填');
    const d = sync2.dayPlansOf('legacy-trip')[0];
    assert(Boolean(d.items[0].id), '旧条目补齐稳定 id 后再入分叉包');
    assert(sync2.cloud.bundles.some((b) => b.kind === 'baseline' && b.trip_id === 'legacy-trip'), '回填数据生成出发基准包');
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
