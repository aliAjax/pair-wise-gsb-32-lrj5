# TripWeaver 旅游行程规划助手

```bash
npm install      # 或 pnpm install
npm run dev      # 或 pnpm dev
```

访问地址：http://localhost:18417

> 一台手机、一个车载浏览器，同改一次出游不再互相覆盖。

TripWeaver 是一款纯前端旅行规划应用。除创建旅行、探索景点、编排每日行程、预算统计、分享预览外，核心支持**多人多设备离线协作**：每次落笔都存成可续作的「分叉包」，断网照常编辑，网络恢复后三路合并——不冲突的改动一起生效，同一时段/同一字段冲突时两份都保留待裁决。

## 快速启动

```bash
npm install
npm run dev        # 开发服务器，访问 http://localhost:18417
npm run build      # 类型检查 + 生产构建，产物在 dist/
npm run preview    # 预览生产构建
npm test           # 运行三路合并 / 压缩 / 回填 / 端到端单测
```

## 多设备离线协作机制（核心）

针对“家人用手机和车上浏览器改同一次出游，后保存盖掉对方改动；空间紧张时保存失败”的问题：

1. **每次落笔 = 一个可续作分叉包（ChangeBundle）**
   - 包内记录 `baseRev`（分叉基准）、`parentId`（续作链）、涉及日期 `dates`、金额 `amount`、设备标识与字段级操作 `ops`、触碰实体的基准快照（三路合并的 base）。
   - 分叉包写入 IndexedDB（`bundles` / `remoteBundles` 两张表），不依赖网络。

2. **断网照常编**
   - 离线时落笔存入锁定的「当前编辑草稿包」，列表/当天路线通过草稿投影立即呈现，但不产生伪冲突。
   - 浏览器 `online` 事件或同步中心手动触发「重联」。

3. **网络恢复后三路合并（base / 本机 / 对方）**
   - 不同实体、不同日期、不同时段的改动**一起生效**。
   - **同一字段（如预算金额）双方都改**：唯一结果保持基准值，两份候选挂为待裁决。
   - **同一天同一时段（时间区间半开相交）安排了不同景点**：两份都从唯一结果中撤出，留待裁决。

4. **裁决前不计费用、不分享**
   - 待裁决条目被排除在预算统计（`budgetCalculator`）之外，也不出现在分享页。
   - 在「行程详情」「行程编排」或「同步中心」的 `<ConflictPanel>` 点选一份即落定，裁决也写成一个分叉包，可续作、可追溯。
   - **列表（/trips）、当天路线（/trip/:id、/planner）、分享页（/share）全部读取同一份重联结果**（`syncStore.canonical`），不存在三处各算各的。

5. **空间紧张先压最旧未锁定包**
   - 写入遇配额错误，或 `navigator.storage.estimate` 超过水位（85%）时，从最旧的**未锁定且非当前编辑**包开始压缩为「检查点」（折叠 ops、保留日期/金额/出处，裁决仍可进行）。
   - **当前编辑草稿包与出发基准包（创建旅行的包）锁定，永不被压缩、不丢。**

6. **旧数据缺版本先回填**
   - 无版本信封的裸数据先按 `tripweaver-v1` 回填信封，再在初始化时迁移为锁定的「出发基准分叉包」并入重联结果。

同步中心 `/sync` 可切换设备（手机 / 车载浏览器）、模拟断网/联网、查看所有分叉包（基准、日期、金额、锁定状态、检查点）、查看存储用量、手动压缩与手动重联；行程详情页提供「模拟家人用车载浏览器分叉编辑」按钮一键演示冲突与合流。

## 主要功能

- 我的旅行：创建、筛选、删除旅行；展示待裁决角标与在线/断网状态。
- 行程详情：日期/金额落笔编辑、每日行程、预算图表、分叉冲突裁决。
- 景点探索：按 SpotCategory 搜索与筛选，收藏并加入行程（落笔金额取景点价格）。
- 行程编排：SortableJS 拖拽排序、修改停留时段，实时影响预算。
- 分享预览：只认同一份重联结果，待裁决内容不出现，可复制行程文本。
- 同步中心：分叉包台账、网络与设备切换、容量水位与压缩、冲突裁决。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript |
| 构建 | Vite |
| UI | Element Plus + ECharts |
| 状态 | Pinia |
| 路由 | Vue Router 4 |
| 持久化 | localStorage（版本信封）+ IndexedDB / Dexie.js（分叉包） |
| 交互 | SortableJS |
| 测试 | Vitest + jsdom + fake-indexeddb |

## 目录结构

```
src/
├── api/              # tripApi / spotApi / dayPlanApi / syncApi（分叉包与配额）
├── stores/           # tripStore / spotStore / dayPlanStore / themeStore / syncStore（同步中枢）
├── models/           # trip.ts / spot.ts / dayPlan.ts / sync.ts（分叉包、冲突、重联结果）
├── types/
├── components/common/# TripCard, SpotCard, DayTimeline, CategoryFilter, SpotMiniCard,
│                     # BudgetChart, TripHeader, EmptyState, ConflictPanel
├── hooks/            # useTripStats / useLocalStorage / useMapSpots
├── pages/            # Trips, TripDetail, Spots, Planner, Share, SyncCenter
├── router/           # index.ts + guards.ts
├── utils/
│   ├── storage.ts            # 版本信封、旧数据回填、Dexie（含 bundles/remoteBundles 表）
│   ├── budgetCalculator.ts   # 预算汇总（排除待裁决条目）
│   ├── formatters.ts / validators.ts / message.ts
│   └── sync/                 # merge（三路合并）、bundle（构建/压缩）、time（时段判定）、ids
├── tests/            # merge / compact / time / storage 单测 + syncStore 端到端
├── config/
└── constants/        # spot / trip / themes / messages / storageVersion / sync
```

## 数据持久化

- **分叉包 / 重联结果**：分叉包存 IndexedDB（Dexie，库 `tripweaver`，v2 schema 新增 `bundles`、`remoteBundles` 表）；重联唯一结果存 localStorage 键 `tripweaver-v2:reconciled`。
- **实体兼容镜像**：trips / spots / dayPlans 仍以版本信封写 localStorage（物理键沿用 `tripweaver-v1:*`，老用户数据可直接被回填读取），但页面统一以重联结果为准。
- 版本常量见 `constants/storageVersion.ts`（当前信封 `tripweaver-v2`）与 `constants/sync.ts`（`tripweaver-sync-v1`）。

## 环境变量

`VITE_AMAP_KEY`：高德地图 key。未配置时使用 demo-key；地图主题配置同时出现在 `config/map.ts`、`SpotCard`、`DayTimeline`、`Planner` 相关逻辑中。

## 枚举出现位置清单

SpotCategory（`nature` / `culture` / `food` / `entertainment`）：
- `src/constants/spot.ts`
- `src/models/spot.ts`
- `src/stores/spotStore.ts`
- `src/components/common/CategoryFilter.vue`
- `src/components/common/SpotCard.vue`
- `src/pages/Spots.vue`
- `src/pages/TripDetail.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

TripStatus（`planning` / `ongoing` / `finished`）：
- `src/constants/trip.ts`
- `src/models/trip.ts`
- `src/stores/tripStore.ts`
- `src/components/common/TripCard.vue`
- `src/pages/Trips.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

## License

MIT
