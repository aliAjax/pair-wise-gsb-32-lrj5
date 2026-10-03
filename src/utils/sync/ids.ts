/** 同一天的 id 必须在手机和车载浏览器两端一致，三路合并才能对上同一时段 */
export function dayIdOf(tripId: string, dayIndex: number): string {
  return `day-${tripId}-${dayIndex}`;
}
