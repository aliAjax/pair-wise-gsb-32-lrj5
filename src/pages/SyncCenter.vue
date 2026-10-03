<template>
  <main class="page sync-center">
    <h1>同步中心</h1>

    <section class="grid">
      <div class="band">
        <h3>设备与网络</h3>
        <p class="muted">当前设备：
          <el-select :model-value="sync.deviceLabel" size="small" style="width: 130px" @update:model-value="sync.setDeviceLabel">
            <el-option v-for="label in DEVICE_LABELS" :key="label" :label="label" :value="label" />
          </el-select>
          <span class="mono">{{ sync.deviceId.slice(0, 8) }}</span>
        </p>
        <p>
          网络：
          <el-switch :model-value="sync.online" active-text="在线" inactive-text="断网" @update:model-value="sync.setOnline" />
        </p>
        <p class="muted">断网时落笔照存为草稿分叉包；切回在线即触发三路重联。</p>
      </div>

      <div class="band">
        <h3>存储空间</h3>
        <p v-if="quota.quota > 0" class="muted">
          已用 {{ (quota.usage / 1024 / 1024).toFixed(2) }} MB /
          {{ (quota.quota / 1024 / 1024).toFixed(0) }} MB（{{ ((quota.ratio * 100).toFixed(1)) }}%）
        </p>
        <el-progress v-if="quota.quota > 0" :percentage="Math.min(100, Math.round(quota.ratio * 100))" :status="quota.nearFull ? 'exception' : undefined" />
        <p v-else class="muted">当前浏览器不支持容量估算，将在写入失败（QuotaExceeded）时自动压缩。</p>
        <div class="toolbar">
          <el-button @click="refreshQuota">刷新容量</el-button>
          <el-button type="warning" @click="sync.compactOldest()">立即压缩最旧未锁定包</el-button>
        </div>
        <p class="muted">压缩规则：只压最旧的未锁定、非当前编辑包；当前草稿包与出发基准包锁定不丢。</p>
      </div>
    </section>

    <el-alert
      v-if="sync.backfilledLegacy"
      type="success"
      :closable="false"
      show-icon
      title="旧数据缺版本已先回填为 tripweaver-v1，再迁移为出发基准分叉包"
      class="toolbar"
    />

    <ConflictPanel />

    <section class="band">
      <h3>分叉包（{{ allBundles.length }}）</h3>
      <p class="muted">每个包记住基准（baseRev）、日期与金额；检查点为空间紧张时压缩折叠后的摘要。</p>
      <el-table :data="allBundles" size="small" stripe>
        <el-table-column label="设备" width="110">
          <template #default="{ row }"><el-tag size="small" :type="row.deviceLabel === '车载浏览器' ? 'warning' : 'success'">{{ row.deviceLabel }}</el-tag></template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'draft' ? 'danger' : row.status === 'checkpoint' ? 'info' : 'success'">
              {{ statusText[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="锁定" width="70">
          <template #default="{ row }">
            <el-button link size="small" @click="sync.toggleLock(row.id)">{{ row.locked ? '🔒 已锁' : '未锁' }}</el-button>
          </template>
        </el-table-column>
        <el-table-column prop="dates" label="日期">
          <template #default="{ row }">{{ (row.dates || []).join('、') || '—' }}</template>
        </el-table-column>
        <el-table-column label="金额" width="110">
          <template #default="{ row }">{{ row.amount }} 元</template>
        </el-table-column>
        <el-table-column label="基准/续作" min-width="220">
          <template #default="{ row }">
            <p class="mono small">base {{ String(row.baseRev).slice(0, 16) }}</p>
            <p class="mono small">{{ row.status === 'checkpoint' ? '已折叠为检查点摘要' : `${row.ops.length} 次落笔` }}</p>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="band">
      <h3>重联唯一结果</h3>
      <p class="muted mono small">rev {{ sync.reconciled.rev }} · 已并入 {{ sync.reconciled.mergedBundleIds.length }} 包 · 更新于 {{ sync.reconciled.updatedAt }}</p>
      <p>列表、当天路线、分享页全部读取这一份结果；未裁决争议已从中摘除。</p>
      <el-button @click="sync.reconcileAll()">手动触发重联合并</el-button>
    </section>
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSyncStore } from '../stores/syncStore';
import ConflictPanel from '../components/common/ConflictPanel.vue';
import { DEVICE_LABELS } from '../constants/sync';
import { quotaSnapshot, type QuotaSnapshot } from '../api/syncApi';

const sync = useSyncStore();
const quota = ref<QuotaSnapshot>({ usage: 0, quota: 0, ratio: 0, nearFull: false });
const statusText: Record<string, string> = { draft: '当前编辑', merged: '已合并', checkpoint: '检查点' };

const allBundles = computed(() =>
  [...sync.bundles, ...sync.remoteBundles].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

async function refreshQuota() {
  quota.value = await sync.maybeCompactByQuota();
}
onMounted(refreshQuota);
</script>
<style scoped>
.monospace, .mono { font-family: ui-monospace, Menlo, monospace; }
.small { font-size: 12px; margin: 2px 0; color: #6b7a63; word-break: break-all; }
</style>
