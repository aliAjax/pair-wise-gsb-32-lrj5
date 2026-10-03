export interface DayPlanItem {
  // v2 起每个条目有稳定 id（v1 旧数据回填时补齐），用于分叉包按条目合并
  id: string;
  spot_id: string;
  start_time: string;
  end_time: string;
  note: string;
  transport: 'walk' | 'metro' | 'taxi' | 'train';
}

export interface DayPlan {
  id: string;
  trip_id: string;
  day_index: number;
  date: string;
  items: DayPlanItem[];
}
