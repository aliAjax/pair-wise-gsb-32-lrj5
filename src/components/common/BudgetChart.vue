<template>
  <div class="band budget-band">
    <div ref="chartEl" class="budget-chart" />
    <el-alert v-if="gated" type="warning" :closable="false" title="有安排待家人裁决，裁决前不计费用" />
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
const props = withDefaults(defineProps<{ spent: number; remaining: number; gated?: boolean }>(), { gated: false });
const chartEl = ref<HTMLDivElement>();
let chart: echarts.ECharts | null = null;
function render() {
  if (!chartEl.value) return;
  chart ||= echarts.init(chartEl.value);
  chart.setOption({
    tooltip: {},
    series: [{
      type: 'pie', radius: ['45%', '70%'],
      data: [
        { name: props.gated ? '已确定（待裁决不计）' : '已计划', value: props.spent },
        { name: '剩余', value: Math.max(0, props.remaining) },
      ],
    }],
  });
}
onMounted(render);
watch(() => [props.spent, props.remaining, props.gated], render);
</script>
<style scoped>
.budget-band { display: grid; gap: 8px; }
.budget-chart { width: 100%; height: 260px; }
</style>
