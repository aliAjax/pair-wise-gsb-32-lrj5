import dayjs from 'dayjs';
import type { DayPlan } from '../models/dayPlan';

// "HH:MM" -> 分钟数，用于同一时段判定
export function toMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

export function shiftTime(value: string, minutes: number): string {
  return dayjs(`2000-01-01 ${value}`).add(minutes, 'minute').format('HH:mm');
}

// 两个时段是否重叠（同一天内）
export function isOverlapping(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = toMinutes(aStart);
  const ae = toMinutes(aEnd) || as + 1;
  const bs = toMinutes(bStart);
  const be = toMinutes(bEnd) || bs + 1;
  return as < be && bs < ae;
}

export function commonItemOrder(base: DayPlan | undefined, target: DayPlan | undefined): string[] {
  if (!base || !target) return [];
  const baseIds = base.items.map((item) => item.id);
  // 只比较基准里就存在、且两边都还在的条目顺序，新增条目不参与排序冲突
  return target.items.map((item) => item.id).filter((id) => baseIds.includes(id));
}
