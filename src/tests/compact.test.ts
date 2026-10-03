import { describe, expect, it } from 'vitest';
import { BUNDLE_STATUS } from '../constants/sync';
import { compactBundle, compactCandidates, newBundle } from '../utils/sync/bundle';

describe('空间紧张压缩规则', () => {
  it('只选未锁定且非当前编辑的包，越旧越先压', () => {
    const baseline = newBundle('d1', '手机', 'rev-0');
    baseline.locked = true;
    baseline.status = BUNDLE_STATUS.MERGED;
    baseline.createdAt = '2026-10-01T08:00:00.000Z';

    const draft = newBundle('d2', '手机', 'rev-1');
    draft.status = BUNDLE_STATUS.DRAFT;
    draft.locked = true;
    draft.createdAt = '2026-10-02T08:00:00.000Z';

    const old = newBundle('d3', '车载浏览器', 'rev-1');
    old.status = BUNDLE_STATUS.MERGED;
    old.createdAt = '2026-10-02T09:00:00.000Z';

    const newer = newBundle('d4', '手机', 'rev-1');
    newer.status = BUNDLE_STATUS.MERGED;
    newer.createdAt = '2026-10-03T09:00:00.000Z';

    const candidates = compactCandidates([baseline, draft, old, newer]);
    expect(candidates.map((bundle) => bundle.deviceId)).toEqual(['d3', 'd4']);
  });

  it('压缩折叠为检查点：ops 清空但日期、金额、出处保留，且标记锁定来源', () => {
    const bundle = newBundle('d5', '车载浏览器', 'rev-1');
    bundle.status = BUNDLE_STATUS.MERGED;
    bundle.dates = ['2026-10-03'];
    bundle.amount = 5000;
    const folded = compactBundle(bundle);
    expect(folded.status).toBe(BUNDLE_STATUS.CHECKPOINT);
    expect(folded.ops).toHaveLength(0);
    expect(folded.dates).toEqual(['2026-10-03']);
    expect(folded.amount).toBe(5000);
    expect(folded.checkpointOf).toBe(bundle.id);
    expect(folded.deviceLabel).toBe('车载浏览器');
  });
});
