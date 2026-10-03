# TripWeaver 旅游行程规划助手

## 快速启动

```bash
npm install        # 或 pnpm install
npm run dev        # 或 pnpm dev
```

访问地址：http://localhost:18417

```bash
npm run build      # 类型检查 + 生产构建，产物在 dist/
node -e "require('esbuild').build({entryPoints:['scripts/sync-smoke.ts'],bundle:true,platform:'node',format:'cjs',outfile:'scripts/.sync-smoke.cjs',loader:{'.vue':'empty'}}).catch(()=>process.exit(1))" && node scripts/.sync-smoke.cjs
# 分叉包合并引擎端到端冒烟（双设备/断网/冲突/压缩/旧数据回填，30 项断言）
```

TripWeaver 是一款纯前端旅行规划应用，支持创建旅行、探索景点、编排每日行程、预算统计和分享预览。**v2 起内置「可续作分叉包」同步引擎**：家人用手机和车上浏览器同时改同一趟出游，不再互相覆盖，断网可照常编辑，联网自动合并，同一时段冲突保留两份待家人裁决。

## 主要功能

- 我的旅行：创建、筛选、删除旅行计划。
- 行程详情：查看每日行程、预算图表、共享时间线、直接修改日期与金额。
- 景点探索：按 SpotCategory 搜索和筛选，收藏并加入行程。
- 行程编排：SortableJS 拖拽排序、改时段/交通/备注，实时影响预算计算。
- 分享预览：生成可复制的行程文本；**有待裁决冲突时冻结分享与费用决算**。
- **分叉包同步**：
  - 每次落笔保存生成一个可续作分叉包，记住基准（parent）、日期与金额快照；
  - 顶部面板可切换「家人手机 / 车上浏览器」两台设备，可手动断网/联网；
  - 断网照常编辑（本地分叉链），网络恢复后三方合并：不冲突的改动一起生效；
  - 同一时段/同一字段两边改成不同结果时，保留两份待选，支持「选 A / 选 B / 两份都留（第二份顺延 30 分钟）」；
  - 裁决前冲突条目不计费用、不能分享；裁决后列表、当天路线、分享页认同一份结果；
  - 空间紧张时先压最旧未锁定包，**出发基准包与各设备当前编辑包永不压缩**；
  - v1 旧数据缺版本号时自动回填为分叉包基准（自动给旧条目补稳定 id）。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript |
| 构建 | Vite |
| UI | Element Plus + ECharts |
| 状态 | Pinia（setup store：syncStore + 实体 store） |
| 路由 | Vue Router 4 |
| 持久化 | localStorage（分叉包日志/云端模拟）+ Dexie.js（IndexedDB 预留） |
| 同步模型 | 可续作分叉包 DAG + 三方合并（自研，`src/sync/`） |
| 交互 | sortablejs |

## 目录结构

```
src/
├── api/                  # 本地数据 API 层：spotApi.ts
├── stores/               # tripStore / spotStore / dayPlanStore / themeStore / syncStore（分叉包编排）
├── models/               # trip.ts, spot.ts, dayPlan.ts, sync.ts（分叉包/冲突/压缩包模型）
├── types/
├── components/common/    # TripCard, SpotCard, DayTimeline, CategoryFilter, SpotMiniCard,
│                         # BudgetChart, TripHeader, EmptyState, SyncPanel, ConflictCenter, TripEditDialog
├── hooks/                # useTripStats.ts, useLocalStorage.ts, useMapSpots.ts
├── pages/                # Trips, TripDetail, Spots, Planner, Share
├── router/               # index.ts + guards.ts
├── utils/                # storage.ts（含空间压力事件）, budgetCalculator.ts（裁决前不计费）,
│                         # formatters.ts, validators.ts, message.ts
├── sync/                 # world.ts（操作重放/投影）, merge.ts（三方合并）, timeslot.ts,
│                         # syncApi.ts（设备日志/云端持久化）, compaction.ts（空间压缩）, backfill.ts（旧数据回填）
├── constants/            # spot.ts, trip.ts, themes.ts, messages.ts, storageVersion.ts, sync.ts
├── config/               # map.ts
└── App.vue
scripts/
└── sync-smoke.ts         # 同步引擎端到端冒烟测试
```

## 分叉包同步模型说明

```
出发基准(base, locked)
   ├─ 手机离线：改金额 ◀─ 改时段 ◀─ 加景点      （本机 pending 链，投影立即可见）
   └─ 车机离线：改金额 ◀─ 加 14:00 安排
                  │ 网络恢复
                  ▼
        三方合并 base / local / remote
   ┌──────────────┴───────────────┐
不冲突改动直接并入         同时段/同字段冲突 → PendingConflict（两份待选）
                                  │ 家人在 ConflictCenter 裁决
                                  ▼
                     resolution 包 → 唯一 canonical 结果
       （旅行列表 / DayTimeline / 分享页 / 预算 全部从 canonical 投影）
```

- 云端在纯前端演示中用 localStorage 模拟（`tripweaver-v2:cloud:*`），跨标签页会通过 `storage` 事件实时拉取；真实部署把 `syncApi` 的 cloud/device 读写替换为服务端接口即可，合并算法不变。
- 每个分叉包含 `parent_id`/`parent_ids`、设备、`snapshot`（出发/结束日期、金额）与操作序列，是可续作的 DAG 节点。

## 数据持久化

- 键版本统一为 `tripweaver-v2`（见 `constants/storageVersion.ts`）。v1 键 `tripweaver-v1:*` 不会被读取进页面，只在首启时由 `sync/backfill.ts` 回填为基准。
- 空间压力：写入抛配额异常或占用超过 85% 时，`utils/storage.ts` 发出压力事件，`syncStore.runCompaction()` 从最旧的未锁定、非基准、非当前末端包开始压缩为 SnapshotPack（支持 CompressionStream gzip，环境不支持时回退紧凑 JSON），随后重试写入。
- Dexie 数据库对象保留用于后续 IndexedDB 扩展。

## 环境变量

`VITE_AMAP_KEY`：高德地图 key。未配置时使用 demo-key，地图主题配置同时出现在 `config/map.ts`、`SpotCard`、`DayTimeline`、`Planner` 相关逻辑中。

## 枚举出现位置清单

SpotCategory：
- `src/constants/spot.ts`
- `src/models/spot.ts`
- `src/stores/spotStore.ts`
- `src/components/common/CategoryFilter.vue`
- `src/components/common/SpotCard.vue`
- `src/pages/Spots.vue`
- `src/pages/TripDetail.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

TripStatus：
- `src/constants/trip.ts`
- `src/models/trip.ts`
- `src/stores/tripStore.ts`
- `src/components/common/TripCard.vue`
- `src/pages/Trips.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

## License

MIT
