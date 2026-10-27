<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { safeMediaURL } from '../lib/api'
import type { Media } from '../lib/types'

const props = defineProps<{ media: Media | null; alt?: string }>()
const failed = ref(false)
const attempt = ref(0)
const source = computed(() => (props.media ? safeMediaURL(props.media.contentUrl) : null))
watch(
  () => props.media?.id,
  () => {
    failed.value = false
    attempt.value = 0
  },
)
function retryPreview() {
  failed.value = false
  attempt.value++
}
</script>

<template>
  <div class="media-preview">
    <img
      v-if="source && !failed && !media?.deletedAt"
      :key="`${media?.id}-${attempt}`"
      :src="source"
      :alt="alt || media?.alt || media?.displayName || '私有素材预览'"
      :width="media?.width"
      :height="media?.height"
      loading="lazy"
      decoding="async"
      @error="failed = true"
    />
    <div v-else class="empty-state">
      <p>
        {{
          media?.deletedAt
            ? '素材已软删除，无法预览。'
            : failed
              ? '预览加载失败，请检查登录状态或重新加载。'
              : '暂无可预览素材。'
        }}
      </p>
      <button v-if="failed" type="button" class="button button--secondary" @click="retryPreview">
        重新加载预览
      </button>
    </div>
    <p v-if="media && !media.deletedAt" class="help-text">
      受登录保护的私有预览，不是公网图片地址。
    </p>
  </div>
</template>
