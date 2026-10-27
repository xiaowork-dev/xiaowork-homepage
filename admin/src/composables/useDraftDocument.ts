import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { admin } from '../lib/admin.ts'
import { ApiError } from '../lib/api.ts'
import { useUnsavedChanges } from './useUnsavedChanges.ts'

type DocumentResponse<T> = { revision: string } & Record<string, T | string | boolean | null>
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function useDraftDocument<T extends object>(path: string, key: string) {
  const value = shallowRef<T | null>(null)
  const revision = ref('')
  const baseline = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const success = ref('')
  const conflict = ref(false)
  const remote = shallowRef<T | null>(null)
  const remoteRevision = ref('')
  const dirty = computed(
    () => value.value !== null && JSON.stringify(value.value) !== baseline.value,
  )
  useUnsavedChanges(dirty)

  function apply(data: DocumentResponse<T>) {
    const document = data[key] as T | null
    value.value = document === null ? null : (reactive(copy(document)) as T)
    revision.value = data.revision
    baseline.value = JSON.stringify(value.value)
    conflict.value = false
    remote.value = null
    remoteRevision.value = ''
  }

  async function load() {
    if (loading.value || saving.value) return
    if (dirty.value && !window.confirm('重新载入会丢弃本页未保存的输入，确定继续吗？')) return
    loading.value = true
    error.value = ''
    success.value = ''
    try {
      apply(await admin.get<DocumentResponse<T>>(path))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '读取失败，请稍后重试。'
    } finally {
      loading.value = false
    }
  }

  async function save() {
    if (!value.value || saving.value || loading.value) return
    saving.value = true
    error.value = ''
    success.value = ''
    try {
      apply(await admin.write<DocumentResponse<T>>('PUT', path, copy(value.value), revision.value))
      success.value = '草稿已保存。公开网站将在后续发布阶段接入，当前未改变。'
    } catch (cause) {
      conflict.value = cause instanceof ApiError && cause.status === 409
      remote.value = null
      error.value = cause instanceof Error ? cause.message : '保存失败，输入已保留。'
    } finally {
      saving.value = false
    }
  }

  async function inspectRemote() {
    if (loading.value || saving.value) return
    error.value = ''
    try {
      const data = await admin.get<DocumentResponse<T>>(path)
      remote.value = copy(data[key] as T)
      remoteRevision.value = data.revision
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '读取远端版本失败。'
    }
  }

  async function reapply() {
    if (!remote.value || !remoteRevision.value || loading.value || saving.value) return
    if (
      !window.confirm(
        '已核对差异？继续将用当前表单完整替换已读取的远端版本。如期间再次发生修改，服务器仍会拒绝覆盖。',
      )
    )
      return
    revision.value = remoteRevision.value
    await save()
  }

  // Deep reactive values allow normal v-model editing while keeping response
  // replacement explicit; no workspace watcher can overwrite an active form.
  const form = computed<T | null>({
    get: () => value.value,
    set: (next) => {
      value.value = next
    },
  })
  function sessionRestored(event: Event) {
    const latestRevision = (event as CustomEvent<{ revision?: string }>).detail?.revision
    if (dirty.value && latestRevision && latestRevision !== revision.value) {
      conflict.value = true
      remote.value = null
      error.value = '重新登录后发现工作区版本已改变。当前输入已保留，请读取远端内容并核对差异。'
    }
  }
  onMounted(() => {
    window.addEventListener('xiaowork:session-restored', sessionRestored)
    void load()
  })
  onBeforeUnmount(() => window.removeEventListener('xiaowork:session-restored', sessionRestored))
  return {
    form,
    revision,
    dirty,
    loading,
    saving,
    error,
    success,
    conflict,
    remote,
    remoteRevision,
    load,
    save,
    inspectRemote,
    reapply,
  }
}
