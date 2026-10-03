// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadLocal } from '../utils/storage';

describe('旧数据缺版本先回填', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => store.set(key, String(value)),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  it('裸数组先按 tripweaver-v1 写回信封，数据原样可读，且标记 legacy', () => {
    localStorage.setItem('tripweaver-v1:trips', JSON.stringify([{ id: 'x' }]));
    const result = loadLocal<{ id: string }[]>('tripweaver-v1:trips', []);
    expect(result.legacy).toBe(true);
    expect(result.data).toEqual([{ id: 'x' }]);
    const rewritten = JSON.parse(localStorage.getItem('tripweaver-v1:trips')!);
    expect(rewritten.version).toBe('tripweaver-v1');
    expect(rewritten.backfilledAt).toBeTruthy();
  });

  it('当前版本信封正常读取且不标记 legacy', () => {
    localStorage.setItem('k', JSON.stringify({ version: 'tripweaver-v2', data: { ok: 1 } }));
    const result = loadLocal<{ ok: number }>('k', { ok: 0 });
    expect(result.legacy).toBe(false);
    expect(result.data.ok).toBe(1);
  });
});
