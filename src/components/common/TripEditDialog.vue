<template>
  <el-dialog :model-value="modelValue" title="修改旅行（日期 / 金额）" width="420px" @update:model-value="$emit('update:modelValue', $event)">
    <el-form label-width="86px">
      <el-form-item label="标题"><el-input v-model="draft.title" /></el-form-item>
      <el-form-item label="目的地"><el-input v-model="draft.destination" /></el-form-item>
      <el-form-item label="出发日期"><el-date-picker v-model="draft.start_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      <el-form-item label="结束日期"><el-date-picker v-model="draft.end_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      <el-form-item label="预算金额"><el-input-number v-model="draft.budget" :min="0" :step="100" /></el-form-item>
      <el-form-item label="同行人">
        <el-input :model-value="draft.members.join('、')" @update:model-value="draft.members = String($event).split(/[、,，\s]+/).filter(Boolean)" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="save">保存为分叉包</el-button>
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import { reactive, watch } from 'vue';
import type { Trip } from '../../models/trip';

const props = defineProps<{ modelValue: boolean; trip: Trip }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; save: [fields: Partial<Trip>] }>();

const draft = reactive<Trip>({ ...props.trip });
watch(() => props.modelValue, (open) => {
  if (open) Object.assign(draft, props.trip);
});
function save() {
  emit('save', {
    title: draft.title,
    destination: draft.destination,
    start_date: draft.start_date,
    end_date: draft.end_date,
    budget: Number(draft.budget),
    members: [...draft.members],
  });
  emit('update:modelValue', false);
}
</script>
