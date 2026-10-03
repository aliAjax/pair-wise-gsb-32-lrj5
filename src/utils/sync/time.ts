/** "HH:mm" 区间工具：同一时段 = 同一天内时间区间相交且触碰同一景点 */

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 半开区间相交判定：[start,end) 有重叠 */
export function slotsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = toMinutes(aStart);
  const ae = toMinutes(aEnd);
  const bs = toMinutes(bStart);
  const be = toMinutes(bEnd);
  return as < be && bs < ae;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
