<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MediaPreview from '../components/MediaPreview.vue'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { admin } from '../lib/admin'
import { ApiError } from '../lib/api'
import { errorText, fileSize, validateImageFile } from '../lib/content'
import type { Media, MediaList } from '../lib/types'

type Metadata = Pick<Media, 'alt' | 'displayName' | 'publicUseConfirmed' | 'publicConfirmationNote'>
const media = ref<Media[]>([])
const revision = ref('')
const status = ref('active')
const nextCursor = ref('')
const loading = ref(false)
const busy = ref(false)
const uploading = ref(false)
const validating = ref(false)
const error = ref('')
const success = ref('')
const dragActive = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const dimensions = ref<{ width: number; height: number } | null>(null)
const uploadRevision = ref('')
const progress = ref(0)
const uploadConflict = ref(false)
const uploadRebased = ref(false)
const uploadReviewed = ref(false)
let validationSequence = 0
const selected = ref<Media | null>(null)
const form = ref<Metadata>({
  alt: '',
  displayName: '',
  publicUseConfirmed: false,
  publicConfirmationNote: '',
})
const baseline = ref('')
const formRevision = ref('')
const conflict = ref(false)
const latest = ref<Metadata | null>(null)
const reviewed = ref(false)
const pendingDelete = ref<Media | null>(null)
const deleteRevision = ref('')
const formDirty = computed(() => !!selected.value && JSON.stringify(form.value) !== baseline.value)
const dirty = computed(() => formDirty.value || !!selectedFile.value)
useUnsavedChanges(dirty)
const totalReferences = (item: Media) =>
  item.references.projects + item.references.documents + item.references.snapshots
const metadata = (item: Media): Metadata => ({
  alt: item.alt,
  displayName: item.displayName,
  publicUseConfirmed: item.publicUseConfirmed,
  publicConfirmationNote: item.publicConfirmationNote,
})

async function readList(append = false) {
  const query = new URLSearchParams({ limit: '100', status: status.value })
  if (append && nextCursor.value) query.set('cursor', nextCursor.value)
  const data = await admin.get<MediaList>(`/media?${query}`)
  media.value = append ? [...media.value, ...data.items] : data.items
  nextCursor.value = data.nextCursor || ''
}
async function reload() {
  if (busy.value || loading.value || validating.value) return
  loading.value = true
  error.value = ''
  try {
    const data = await admin.loadWorkspace()
    await readList()
    revision.value = data.revision
    selected.value = null
    pendingDelete.value = null
    clearFile()
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    loading.value = false
  }
}
async function more() {
  if (busy.value || loading.value) return
  loading.value = true
  try {
    await readList(true)
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    loading.value = false
  }
}
async function refreshAfterWrite() {
  try {
    const data = await admin.loadWorkspace()
    revision.value = data.revision
    await readList()
  } catch (cause) {
    error.value = `操作已成功，但列表刷新失败：${errorText(cause)}。请重新加载。`
  }
}
function clearFile() {
  validationSequence++
  selectedFile.value = null
  dimensions.value = null
  uploadConflict.value = false
  uploadRebased.value = false
  uploadReviewed.value = false
  validating.value = false
  progress.value = 0
  if (fileInput.value) fileInput.value.value = ''
}
async function selectFiles(files: FileList | File[] | null) {
  if (busy.value || !!selected.value || !files?.length) return
  error.value = ''
  success.value = ''
  if (files.length !== 1) {
    error.value = '每次只能上传一张图片，请分别选择。'
    return
  }
  const file = files[0]
  if (!file) return
  const sequence = ++validationSequence
  validating.value = true
  selectedFile.value = null
  dimensions.value = null
  try {
    const size = await validateImageFile(file)
    if (sequence !== validationSequence) return
    selectedFile.value = file
    dimensions.value = size
    uploadRevision.value = revision.value
    uploadConflict.value = false
    uploadRebased.value = false
    uploadReviewed.value = false
  } catch (cause) {
    if (sequence === validationSequence) error.value = errorText(cause)
  } finally {
    if (sequence === validationSequence) validating.value = false
  }
}
function fileChanged(event: Event) {
  void selectFiles((event.target as HTMLInputElement).files)
}
function drop(event: DragEvent) {
  dragActive.value = false
  void selectFiles(event.dataTransfer?.files ?? null)
}
async function upload() {
  if (busy.value) return
  if (!selectedFile.value || uploadConflict.value || (uploadRebased.value && !uploadReviewed.value))
    return
  busy.value = true
  uploading.value = true
  progress.value = 0
  error.value = ''
  try {
    const data = await admin.upload(selectedFile.value, uploadRevision.value, (value) => {
      progress.value = value
    })
    clearFile()
    revision.value = data.revision
    openMetadata(data.media, data.revision)
    success.value = data.media.publicUseConfirmed
      ? '图片已处理，相同内容会复用已有素材。当前素材已有公开使用确认，请核对原说明；本次没有发布网站。'
      : '图片已安全重编码并保存到私有素材库，相同内容会复用已有素材；尚未确认公开使用，也没有发布。请核实后编辑说明。'
    await refreshAfterWrite()
  } catch (cause) {
    error.value = errorText(cause)
    if (cause instanceof ApiError && cause.code === 'REVISION_CONFLICT') uploadConflict.value = true
  } finally {
    busy.value = false
    uploading.value = false
  }
}
async function rebaseUpload() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const data = await admin.loadWorkspace()
    revision.value = data.revision
    uploadRevision.value = data.revision
    uploadConflict.value = false
    uploadRebased.value = true
    uploadReviewed.value = false
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
function openMetadata(item: Media, base = revision.value) {
  selected.value = item
  form.value = metadata(item)
  baseline.value = JSON.stringify(form.value)
  formRevision.value = base
  conflict.value = false
  latest.value = null
  reviewed.value = false
  error.value = ''
}
async function saveMetadata() {
  if (busy.value) return
  if (
    !selected.value ||
    selected.value.deletedAt ||
    conflict.value ||
    (latest.value && !reviewed.value)
  )
    return
  if (form.value.publicUseConfirmed && !form.value.publicConfirmationNote.trim()) {
    error.value = '确认可公开使用时，请填写核验说明，例如已核实来源且不含敏感信息。'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const data = await admin.write<{ media: Media; revision: string }>(
      'PATCH',
      `/media/${encodeURIComponent(selected.value.id)}`,
      form.value,
      formRevision.value,
    )
    openMetadata(data.media, data.revision)
    success.value = '素材信息已保存。公开使用确认仅是内容声明，不代表已发布。'
    await refreshAfterWrite()
  } catch (cause) {
    error.value = errorText(cause)
    if (cause instanceof ApiError && cause.code === 'REVISION_CONFLICT') conflict.value = true
  } finally {
    busy.value = false
  }
}
async function resolveConflict(keepInput: boolean) {
  if (busy.value) return
  if (!selected.value) return
  busy.value = true
  error.value = ''
  try {
    const workspace = await admin.loadWorkspace()
    const data = await admin.get<{ media: Media }>(
      `/media/${encodeURIComponent(selected.value.id)}`,
    )
    revision.value = workspace.revision
    if (data.media.deletedAt) {
      error.value = '此素材已软删除，当前输入仍保留。请复制需要的信息后放弃表单。'
      return
    }
    if (keepInput) {
      selected.value = data.media
      latest.value = metadata(data.media)
      formRevision.value = workspace.revision
      reviewed.value = false
      conflict.value = false
      success.value = '输入已保留，服务端最新值见下方。请对照并明确确认后再次保存。'
    } else {
      openMetadata(data.media, workspace.revision)
      success.value = '已放弃旧输入并载入素材最新值。'
    }
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
function askDelete(item: Media) {
  pendingDelete.value = item
  deleteRevision.value = revision.value
  error.value = ''
}
async function remove() {
  if (busy.value) return
  if (!pendingDelete.value) return
  busy.value = true
  error.value = ''
  try {
    await admin.write(
      'DELETE',
      `/media/${encodeURIComponent(pendingDelete.value.id)}`,
      undefined,
      deleteRevision.value,
    )
    if (selected.value?.id === pendingDelete.value.id) selected.value = null
    pendingDelete.value = null
    success.value = '素材已软删除；物理文件保留，不执行垃圾清理。'
    await refreshAfterWrite()
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
function sessionRestored(event: Event) {
  const current = (event as CustomEvent<{ revision?: string }>).detail?.revision
  if (!current || !/^ws-[0-9]+$/.test(current)) return
  if (selected.value && current !== formRevision.value) {
    conflict.value = true
    latest.value = null
    reviewed.value = false
    error.value = '登录已恢复，但工作区已有变化。素材输入与原始版本仍保留，请读取最新基准并核对。'
  } else if (selectedFile.value && current !== uploadRevision.value) {
    uploadConflict.value = true
    uploadRebased.value = false
    uploadReviewed.value = false
    error.value = '登录已恢复，但上传基准已改变。所选文件仍保留，请明确读取最新基准后再上传。'
  } else if (current !== revision.value) {
    error.value = '登录已恢复，工作区已有变化。请重新加载素材列表后继续操作。'
  }
}
onMounted(reload)
onMounted(() => window.addEventListener('xiaowork:session-restored', sessionRestored))
onBeforeUnmount(() => {
  validationSequence++
  window.removeEventListener('xiaowork:session-restored', sessionRestored)
})
</script>

<template>
  <section class="admin-page stack" aria-labelledby="media-title">
    <header class="page-header">
      <div>
        <p class="eyebrow">内容管理 / 私有存储</p>
        <h1 id="media-title" tabindex="-1">素材库</h1>
        <p class="muted">上传、核验与管理真实图片。素材不会自动进入公开网站。</p>
      </div>
      <button
        class="button button--secondary"
        :disabled="busy || loading || validating"
        @click="reload"
      >
        {{ dirty ? '放弃未保存修改并重新加载' : '重新加载' }}
      </button>
    </header>
    <p v-if="error" role="alert" class="alert alert--error">{{ error }}</p>
    <p v-if="success" role="status" class="alert alert--success">{{ success }}</p>
    <section class="panel stack" aria-labelledby="upload-title">
      <h2 id="upload-title">上传图片</h2>
      <p class="help-text">
        PNG、JPEG、WebP，原图最多 10 MiB，重编码后最多 16 MiB，单边 ≤ 8,192 px、总像素 ≤ 2,500
        万。服务端再次校验并重编码、剥离元数据；SVG、GIF、AVIF 上传暂不支持。
      </p>
      <div
        class="dropzone"
        :class="{ 'dropzone--active': dragActive }"
        @dragover.prevent="dragActive = !busy && !selected"
        @dragleave.prevent="dragActive = false"
        @drop.prevent="drop"
      >
        <label class="field"
          >选择上传图片<input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            :disabled="busy || loading || !!selected"
            @change="fileChanged"
        /></label>
        <p class="help-text">
          也可将一张图片拖入此区域。{{ selected ? '请先关闭素材编辑表单，再选择文件。' : '' }}
        </p>
      </div>
      <p v-if="validating" role="status">正在检查图片格式与尺寸…</p>
      <div v-if="selectedFile" class="panel stack">
        <p>
          <strong>{{ selectedFile.name }}</strong> · {{ fileSize(selectedFile.size) }} ·
          {{ dimensions?.width }} × {{ dimensions?.height }} px
        </p>
        <p class="help-text">
          等待上传，基准版本 {{ uploadRevision }}。客户端检查通过不等于服务端校验通过。
        </p>
        <label v-if="uploading" class="field"
          >上传进度<progress class="progress" :value="progress" max="100">{{ progress }}%</progress
          ><span role="status">{{
            progress < 100 ? `${progress}%` : '文件已发送，等待服务端处理…'
          }}</span></label
        >
        <p v-if="uploadConflict" class="alert alert--error">
          工作区已更新，所选文件仍保留。请读取最新基准后明确重试，或取消本次上传。
        </p>
        <button
          v-if="uploadConflict"
          class="button button--secondary"
          :disabled="busy"
          @click="rebaseUpload"
        >
          保留文件，读取最新上传基准</button
        ><label v-if="uploadRebased" class="checkbox-field"
          ><input
            v-model="uploadReviewed"
            type="checkbox"
          />我已确认在最新工作区中重新提交此文件。</label
        >
        <div class="actions">
          <button
            class="button button--primary"
            :disabled="busy || validating || uploadConflict || (uploadRebased && !uploadReviewed)"
            @click="upload"
          >
            {{ busy ? '正在上传…' : '上传到私有素材库' }}</button
          ><button class="button button--secondary" :disabled="busy" @click="clearFile">
            取消选择
          </button>
        </div>
      </div>
    </section>

    <form
      v-if="selected"
      class="panel stack"
      aria-labelledby="media-form-title"
      @submit.prevent="saveMetadata"
    >
      <h2 id="media-form-title">素材信息：{{ selected.displayName || selected.id }}</h2>
      <MediaPreview :media="selected" />
      <p class="help-text">
        {{ selected.width }} × {{ selected.height }} px · {{ fileSize(selected.byteSize) }} ·
        {{ selected.mediaType }} · 基准版本 {{ formRevision }}
      </p>
      <p class="help-text">
        项目引用 {{ selected.references.projects }} / 资料设置引用
        {{ selected.references.documents }} / 历史快照引用 {{ selected.references.snapshots }}
      </p>
      <template v-if="!selected.deletedAt">
        <label class="field"
          >素材显示名称<input v-model="form.displayName" maxlength="160" :disabled="busy"
        /></label>
        <label class="field"
          >素材替代文本<input v-model="form.alt" maxlength="500" :disabled="busy"
        /></label>
        <label class="checkbox-field"
          ><input
            v-model="form.publicUseConfirmed"
            type="checkbox"
            :disabled="busy"
          />我已核实此图片可公开使用，且不含敏感数据。</label
        >
        <label class="field"
          >公开使用核验说明<textarea
            v-model="form.publicConfirmationNote"
            maxlength="2000"
            rows="3"
            :required="form.publicUseConfirmed"
            :disabled="busy"
          /><span class="help-text"
            >请说明来源与脱敏核验。ERP 截图必须确认无客户、权限或业务敏感数据。</span
          ></label
        >
        <p class="alert">
          公开确认只允许后续内容引用，不会自动发布，也不会把私有预览地址变成公网永久地址。
        </p>
        <div v-if="conflict" class="alert alert--error stack" role="alert">
          <p>版本冲突，当前输入已完整保留，没有自动重试。</p>
          <div class="actions">
            <button
              type="button"
              class="button button--secondary"
              :disabled="busy"
              @click="resolveConflict(false)"
            >
              放弃输入，载入最新素材信息</button
            ><button
              type="button"
              class="button button--secondary"
              :disabled="busy"
              @click="resolveConflict(true)"
            >
              保留输入，读取最新基准作对照
            </button>
          </div>
        </div>
        <details v-if="latest" open class="panel">
          <summary>服务端最新素材信息</summary>
          <pre>{{ JSON.stringify(latest, null, 2) }}</pre>
          <label class="checkbox-field"
            ><input
              v-model="reviewed"
              type="checkbox"
            />我已核对，确认使用当前输入更新上述最新信息。</label
          >
        </details>
      </template>
      <div class="actions">
        <button
          v-if="!selected.deletedAt"
          type="submit"
          class="button button--primary"
          :disabled="busy || conflict || (!!latest && !reviewed)"
        >
          {{ busy ? '正在保存…' : '保存素材信息' }}</button
        ><button
          type="button"
          class="button button--secondary"
          :disabled="busy"
          @click="selected = null"
        >
          {{ formDirty ? '放弃编辑并关闭' : '关闭素材信息' }}
        </button>
      </div>
    </form>

    <section v-if="pendingDelete" class="panel stack" aria-label="确认软删除素材">
      <h2>软删除素材：{{ pendingDelete.displayName || pendingDelete.id }}</h2>
      <p>仅删除无引用素材的可用状态，保留物理文件与审计记录。本阶段没有恢复或物理清理入口。</p>
      <div class="actions">
        <button class="button button--danger" :disabled="busy" @click="remove">
          确认软删除素材</button
        ><button class="button button--secondary" :disabled="busy" @click="pendingDelete = null">
          取消
        </button>
      </div>
      <p class="help-text">引用或版本冲突时不会自动重试，请取消后重新加载核对。</p>
    </section>

    <section class="panel stack" aria-label="素材列表">
      <div class="toolbar">
        <h2>已上传素材</h2>
        <label class="field"
          >素材状态<select v-model="status" :disabled="busy || loading || dirty" @change="reload">
            <option value="active">可用素材</option>
            <option value="deleted">已软删除</option>
            <option value="all">全部素材</option>
          </select></label
        >
      </div>
      <p v-if="loading" role="status">正在读取素材…</p>
      <div class="media-grid">
        <article v-for="item in media" :key="item.id" class="media-card stack">
          <MediaPreview :media="item" />
          <h3>{{ item.displayName || item.id }}</h3>
          <p class="help-text">
            {{ item.width }} × {{ item.height }} px · {{ fileSize(item.byteSize) }}
          </p>
          <div class="actions">
            <span class="badge">{{
              item.deletedAt ? '已软删除' : item.publicUseConfirmed ? '已确认可公开' : '待公开核验'
            }}</span
            ><span v-if="totalReferences(item)" class="badge"
              >{{ totalReferences(item) }} 处引用</span
            >
          </div>
          <div class="actions">
            <button
              class="button button--secondary"
              :disabled="busy || dirty || !!pendingDelete"
              :aria-label="`查看素材 ${item.displayName || item.id}`"
              @click="openMetadata(item)"
            >
              查看 / 编辑</button
            ><button
              v-if="!item.deletedAt"
              class="button button--danger"
              :disabled="busy || dirty || !!pendingDelete || totalReferences(item) > 0"
              :aria-label="`软删除 ${item.displayName || item.id}`"
              @click="askDelete(item)"
            >
              软删除
            </button>
          </div>
          <p v-if="totalReferences(item)" class="help-text">仍被草稿或历史快照引用，不能删除。</p>
        </article>
      </div>
      <p v-if="!loading && !media.length" class="empty-state">
        当前筛选下暂无上传素材。内置占位资源不属于上传素材库。
      </p>
      <button
        v-if="nextCursor"
        class="button button--secondary"
        :disabled="loading || busy"
        @click="more"
      >
        加载更多素材
      </button>
    </section>
  </section>
</template>
