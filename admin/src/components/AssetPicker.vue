<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { admin } from '../lib/admin'
import { builtinAssets, builtinCovers, errorText } from '../lib/content'
import type { AssetReference, Media, MediaList } from '../lib/types'
import MediaPreview from './MediaPreview.vue'

const props = withDefaults(
  defineProps<{
    modelValue: AssetReference | null
    label?: string
    allowBuiltin?: boolean
    clearable?: boolean
    disabled?: boolean
  }>(),
  { label: '图片素材', allowBuiltin: false, clearable: false, disabled: false },
)
const emit = defineEmits<{
  'update:modelValue': [value: AssetReference | null]
  selected: [value: Media | null]
}>()
const open = ref(false)
const loading = ref(false)
const error = ref('')
const items = ref<Media[]>([])
const nextCursor = ref('')
const selected = ref<Media | null>(null)
const builtin = computed(() => builtinAssets.find((item) => item.id === props.modelValue?.id))
const eligible = computed(() =>
  items.value.filter((item) => !item.deletedAt && item.publicUseConfirmed),
)

watch(
  () => (props.modelValue?.kind === 'media' && !builtin.value ? props.modelValue.id : ''),
  async (id) => {
    selected.value = null
    error.value = ''
    if (!id) return
    try {
      const data = await admin.get<{ media: Media }>(`/media/${encodeURIComponent(id)}`)
      if (props.modelValue?.id === id) selected.value = data.media
    } catch (cause) {
      error.value = errorText(cause)
    }
  },
  { immediate: true },
)

async function load(append = false) {
  loading.value = true
  error.value = ''
  try {
    const query = new URLSearchParams({ limit: '100', status: 'active' })
    if (append && nextCursor.value) query.set('cursor', nextCursor.value)
    const data = await admin.get<MediaList>(`/media?${query}`)
    items.value = append ? [...items.value, ...data.items] : data.items
    nextCursor.value = data.nextCursor || ''
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    loading.value = false
  }
}
async function toggle() {
  open.value = !open.value
  if (open.value) await load()
}
function choose(media: Media) {
  if (props.disabled || media.deletedAt || !media.publicUseConfirmed) return
  selected.value = media
  emit('update:modelValue', { kind: 'media', id: media.id })
  emit('selected', media)
  open.value = false
}
function chooseBuiltin(id: string) {
  if (props.disabled) return
  emit('update:modelValue', { kind: 'builtin', id })
  emit('selected', null)
  open.value = false
}
function clear() {
  selected.value = null
  emit('update:modelValue', null)
  emit('selected', null)
}
</script>

<template>
  <div class="stack asset-picker">
    <strong>{{ label }}</strong>
    <div v-if="builtin" class="panel">
      <img :src="builtin.path" :alt="builtin.label" width="320" height="200" loading="lazy" />
      <p class="help-text">{{ builtin.label }}（仓库内置资源，保留已有引用）</p>
    </div>
    <MediaPreview v-else-if="selected" :media="selected" />
    <p v-else class="help-text">
      {{ modelValue?.id ? `当前素材：${modelValue.id}，等待读取。` : '尚未选择图片。' }}
    </p>
    <p v-if="selected && !selected.publicUseConfirmed" class="alert alert--error">
      当前素材尚未确认可公开使用，请先到素材库核验。
    </p>
    <div class="actions">
      <button
        type="button"
        class="button button--secondary"
        :disabled="disabled || loading"
        :aria-expanded="open"
        :aria-label="`${open ? '收起' : '选择'}${label}`"
        @click="toggle"
      >
        {{ open ? '收起素材列表' : '选择素材' }}
      </button>
      <button
        v-if="clearable && modelValue"
        type="button"
        class="button button--ghost"
        :disabled="disabled"
        :aria-label="`清除${label}`"
        @click="clear"
      >
        清除选择
      </button>
    </div>
    <p v-if="error" role="alert" class="alert alert--error">{{ error }}</p>
    <div v-if="open" class="panel stack">
      <p class="help-text">
        这里只能选择已确认可公开的素材。上传与公开使用确认请到「素材库」完成；选择不会发布网站。
      </p>
      <div v-if="allowBuiltin" class="actions">
        <button
          v-for="item in builtinCovers"
          :key="item.id"
          type="button"
          class="button button--secondary"
          :disabled="disabled"
          :aria-pressed="modelValue?.id === item.id"
          @click="chooseBuiltin(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
      <p v-if="loading" role="status">正在读取素材…</p>
      <div class="media-grid">
        <article v-for="media in eligible" :key="media.id" class="media-card stack">
          <MediaPreview :media="media" />
          <strong>{{ media.displayName || media.id }}</strong>
          <button
            type="button"
            class="button button--secondary"
            :disabled="disabled"
            :aria-pressed="modelValue?.id === media.id"
            @click="choose(media)"
          >
            选择此素材
          </button>
        </article>
      </div>
      <p v-if="!loading && !eligible.length" class="empty-state">
        暂无已确认可公开的上传素材。未确认素材不会显示为可选项。
      </p>
      <button
        v-if="nextCursor"
        type="button"
        class="button button--secondary"
        :disabled="loading"
        @click="load(true)"
      >
        加载更多素材
      </button>
    </div>
  </div>
</template>
