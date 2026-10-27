<script setup lang="ts">
defineProps<{ dirty: boolean; saving: boolean; revision: string }>()
defineEmits<{ reload: [] }>()
</script>
<template>
  <div class="save-bar">
    <div>
      <span class="badge" :class="{ 'badge--warning': dirty }">{{
        dirty ? '有未保存修改' : '与已读取草稿一致'
      }}</span
      ><small class="muted"> {{ revision }}</small>
    </div>
    <div class="actions">
      <button
        type="button"
        class="button button--secondary"
        :disabled="saving"
        @click="$emit('reload')"
      >
        重新载入</button
      ><button class="button button--primary" type="submit" :disabled="saving || !dirty">
        {{ saving ? '正在保存…' : '保存草稿' }}
      </button>
    </div>
  </div>
</template>
