import { describe, expect, it } from 'vitest';
import { emptyReconciled, reconcile } from '../utils/sync/merge';
import { appendOp, ensureItemPatch, newBundle } from '../utils/sync/bundle';
import { CHANGE_KIND } from '../constants/sync';
import type { ChangeBundle } from '../models/sync';

const TRIP = 'trip-1';

function tripOp(bundle: ChangeBundle, budget: number) {
  appendOp(bundle, {
    kind: CHANGE_KIND.ENTITY_UPSERT,
    entity: 'trips',
    entityId: TRIP,
    patch: { id: TRIP, title: '周末出游', budget, start_date: '2026-10-10' },
    onDate: '2026-10-03',
    amount: budget,
  });
}

describe('分叉包三路合并', () => {
  it('不冲突的改动一起生效：手机改金额，车载浏览器加第 2 天的安排', () => {
    const base = newBundle('d-base', '手机', 'rev-0');
    tripOp(base, 3200);
    let state = reconcile(emptyReconciled(), [base], true);
    expect(state.trips[0].budget).toBe(3200);

    const phone = newBundle('d-phone', '手机', state.rev, {
      trips: { [TRIP]: { id: TRIP, title: '周末出游', budget: 3200, start_date: '2026-10-10' } },
      dayPlans: {},
    });
    tripOp(phone, 4200);

    const car = newBundle('d-car', '车载浏览器', state.rev, {
      trips: { [TRIP]: { id: TRIP, title: '周末出游', budget: 3200, start_date: '2026-10-10' } },
      dayPlans: {},
    });
    appendOp(car, {
      kind: CHANGE_KIND.ITEM_UPSERT,
      entity: 'dayPlans',
      entityId: `day-${TRIP}-2`,
      tripId: TRIP,
      dayIndex: 2,
      date: '2026-10-11',
      item: ensureItemPatch({ spot_id: 'spot-market', start_time: '18:00', end_time: '20:00' }),
      onDate: '2026-10-11',
      amount: 120,
    });

    state = reconcile(state, [phone, car], true);
    expect(state.trips[0].budget).toBe(4200);
    const dayTwo = state.dayPlans.find((day) => day.day_index === 2);
    expect(dayTwo?.items).toHaveLength(1);
    expect(state.conflicts).toHaveLength(0);
  });

  it('同一字段（金额）双方都改：留两份待裁决，唯一结果保持原值', () => {
    const base = newBundle('d-base', '手机', 'rev-0');
    tripOp(base, 3200);
    let state = reconcile(emptyReconciled(), [base], true);

    const baseline = { trips: { [TRIP]: { id: TRIP, budget: 3200 } }, dayPlans: {} };
    const phone = newBundle('d-phone', '手机', state.rev, JSON.parse(JSON.stringify(baseline)));
    tripOp(phone, 4200);
    const car = newBundle('d-car', '车载浏览器', state.rev, JSON.parse(JSON.stringify(baseline)));
    tripOp(car, 5000);

    state = reconcile(state, [phone, car], true);
    // 裁决前唯一结果保持基准金额，两份候选（4200 / 5000）挂在冲突上待选
    expect(state.trips[0].budget).toBe(3200);
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0].candidates.map((candidate) => candidate.value).sort()).toEqual([4200, 5000]);
  });

  it('同一天同一时段两个景点：双方都撤出唯一结果，裁决选中后落定一份', () => {
    const seed = newBundle('d-seed', '手机', 'rev-0');
    tripOp(seed, 3200);
    appendOp(seed, {
      kind: CHANGE_KIND.ITEM_UPSERT,
      entity: 'dayPlans',
      entityId: `day-${TRIP}-1`,
      tripId: TRIP,
      dayIndex: 1,
      date: '2026-10-10',
      item: ensureItemPatch({ spot_id: 'spot-westlake', start_time: '10:00', end_time: '12:00' }),
      onDate: '2026-10-10',
      amount: 0,
    });
    let state = reconcile(emptyReconciled(), [seed], true);

    const phone = newBundle('d-phone', '手机', state.rev, {
      trips: {},
      dayPlans: {},
    });
    appendOp(phone, {
      kind: CHANGE_KIND.ITEM_UPSERT,
      entity: 'dayPlans',
      entityId: `day-${TRIP}-1`,
      tripId: TRIP,
      dayIndex: 1,
      date: '2026-10-10',
      item: ensureItemPatch({ spot_id: 'spot-park', start_time: '10:30', end_time: '11:30' }),
      onDate: '2026-10-10',
      amount: 180,
    });
    state = reconcile(state, [phone], true);
    // 新增项与已有项时段相交：双方都应被摘除
    const day = state.dayPlans.find((item) => item.day_index === 1);
    expect(day?.items ?? []).toHaveLength(0);
    expect(state.conflicts).toHaveLength(1);

    const chosen = state.conflicts[0].candidates[1].bundleId;
    const resolution = newBundle('d-resolve', '手机', state.rev);
    appendOp(resolution, {
      kind: CHANGE_KIND.RESOLUTION,
      conflictId: state.conflicts[0].id,
      chosenBundleId: chosen,
      droppedBundleId: state.conflicts[0].candidates[0].bundleId,
      onDate: '2026-10-10',
      amount: 180,
    });
    state = reconcile(state, [resolution], true);
    expect(state.conflicts).toHaveLength(0);
    expect(state.resolved).toHaveLength(1);
    const after = state.dayPlans.find((item) => item.day_index === 1) as { items: { spot_id: string }[] } | undefined;
    expect(after?.items).toHaveLength(1);
    expect(after?.items[0].spot_id).toBe('spot-park');
  });

  it('不同时段的改动不冲突，可同处一天', () => {
    const seed = newBundle('d-seed', '手机', 'rev-0');
    tripOp(seed, 3200);
    appendOp(seed, {
      kind: CHANGE_KIND.ITEM_UPSERT,
      entity: 'dayPlans',
      entityId: `day-${TRIP}-1`,
      tripId: TRIP,
      dayIndex: 1,
      date: '2026-10-10',
      item: ensureItemPatch({ spot_id: 'spot-westlake', start_time: '09:00', end_time: '10:00' }),
      onDate: '2026-10-10',
      amount: 0,
    });
    let state = reconcile(emptyReconciled(), [seed], true);

    const car = newBundle('d-car', '车载浏览器', state.rev, { trips: {}, dayPlans: {} });
    appendOp(car, {
      kind: CHANGE_KIND.ITEM_UPSERT,
      entity: 'dayPlans',
      entityId: `day-${TRIP}-1`,
      tripId: TRIP,
      dayIndex: 1,
      date: '2026-10-10',
      item: ensureItemPatch({ spot_id: 'spot-market', start_time: '18:00', end_time: '20:00' }),
      onDate: '2026-10-10',
      amount: 120,
    });
    state = reconcile(state, [car], true);
    const day = state.dayPlans.find((item) => item.day_index === 1);
    expect(day?.items).toHaveLength(2);
    expect(state.conflicts).toHaveLength(0);
  });
});
