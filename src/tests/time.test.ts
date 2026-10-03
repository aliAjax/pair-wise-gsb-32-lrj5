import { describe, expect, it } from 'vitest';
import { slotsOverlap, toMinutes } from '../utils/sync/time';

describe('同一时段判定', () => {
  it('半开区间：相接不算冲突，相交才算', () => {
    expect(slotsOverlap('10:00', '12:00', '12:00', '13:00')).toBe(false);
    expect(slotsOverlap('10:00', '12:00', '11:30', '13:00')).toBe(true);
    expect(slotsOverlap('10:00', '12:00', '08:00', '10:00')).toBe(false);
    expect(toMinutes('09:30')).toBe(570);
  });
});
