<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{
  local: object | null
  remote: object | null
  revision: string
  busy?: boolean
}>()
defineEmits<{ inspect: []; reload: []; reapply: [] }>()
function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.assign(
      {},
      ...Object.entries(value).map(([key, part]) =>
        flatten(part, prefix ? `${prefix}.${key}` : key),
      ),
    )
  }
  return { [prefix]: typeof value === 'string' ? value : JSON.stringify(value) }
}
const differences = computed(() => {
  if (!props.local || !props.remote) return []
  const local = flatten(props.local),
    remote = flatten(props.remote)
  return [...new Set([...Object.keys(local), ...Object.keys(remote)])]
    .filter((key) => local[key] !== remote[key])
    .map((key) => ({ key, local: local[key] ?? '未设置', remote: remote[key] ?? '未设置' }))
})
</script>

<template>
  <section class="alert alert--warning conflict-panel" aria-label="版本冲突处理">
    <h2>远端草稿已经改变，当前输入已保留</h2>
    <p>其他标签页或操作更新了工作区。请读取最新版本并核对差异，再选择如何继续。</p>
    <div class="actions">
      <button type="button" class="button" :disabled="busy" @click="$emit('inspect')">
        读取最新版本并比较
      </button>
      <button
        type="button"
        class="button button--secondary"
        :disabled="busy"
        @click="$emit('reload')"
      >
        丢弃输入，载入最新版本
      </button>
    </div>
    <template v-if="remote">
      <p>
        已读取远端版本 <code>{{ revision }}</code
        >。左侧为当前输入，右侧为远端内容。
      </p>
      <div v-if="differences.length" class="table-wrap">
        <table class="data-table comparison-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>当前输入</th>
              <th>远端内容</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in differences" :key="item.key">
              <th>{{ item.key }}</th>
              <td>
                <pre>{{ item.local }}</pre>
              </td>
              <td>
                <pre>{{ item.remote }}</pre>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else>当前输入与已读取的远端内容一致。</p>
      <button
        class="button button--primary"
        type="button"
        :disabled="busy"
        @click="$emit('reapply')"
      >
        已核对，在此版本上重试保存
      </button>
    </template>
  </section>
</template>
