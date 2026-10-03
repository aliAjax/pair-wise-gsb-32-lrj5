import { createRouter, createWebHistory } from 'vue-router';
import Trips from '../pages/Trips.vue';
import TripDetail from '../pages/TripDetail.vue';
import Spots from '../pages/Spots.vue';
import Planner from '../pages/Planner.vue';
import Share from '../pages/Share.vue';
import SyncCenter from '../pages/SyncCenter.vue';
import { installGuards } from './guards';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/trips' },
    { path: '/trips', component: Trips, meta: { title: '我的旅行' } },
    { path: '/trip/:id', component: TripDetail, meta: { title: '行程详情' } },
    { path: '/spots', component: Spots, meta: { title: '景点探索' } },
    { path: '/planner/:tripId/:dayIndex', component: Planner, meta: { title: '行程编排' } },
    { path: '/share', component: Share, meta: { title: '分享预览' } },
    { path: '/sync', component: SyncCenter, meta: { title: '同步中心' } },
  ],
});
installGuards(router);
export default router;
