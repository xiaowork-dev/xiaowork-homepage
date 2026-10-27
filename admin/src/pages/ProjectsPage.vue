<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AssetPicker from '../components/AssetPicker.vue'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { admin } from '../lib/admin'
import { ApiError, newIdempotencyKey } from '../lib/api'
import {
  clone,
  errorText,
  moveItem,
  projectInput,
  projectStatuses,
  statusLabel,
} from '../lib/content'
import type { AssetReference, Category, Project, ProjectInput } from '../lib/types'

const projects = ref<Project[]>([])
const categories = ref<Category[]>([])
const revision = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const success = ref('')
const search = ref('')
const categoryFilter = ref('')
const statusFilter = ref('')
const archivedFilter = ref('active')
const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref<ProjectInput>(projectInput())
const techText = ref('')
const baseline = ref('')
const formRevision = ref('')
const idempotencyKey = ref('')
const conflict = ref(false)
const comparison = ref<ProjectInput | null>(null)
const reviewed = ref(false)
const confirmedFacts = ref(false)
const sorting = ref(false)
const orderItems = ref<Project[]>([])
const orderBaseline = ref('')
const orderRevision = ref('')
const orderConflict = ref(false)
const draggedId = ref('')
const pendingAction = ref<{
  project: Project
  type: 'archive' | 'restore'
  revision: string
} | null>(null)

const payload = computed<ProjectInput>(() => ({
  ...clone(form.value),
  techStack: techText.value
    .split(/[\n,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean),
  demoUrl: form.value.demoUrl?.trim() || null,
  repositoryUrl: form.value.repositoryUrl?.trim() || null,
}))
const formDirty = computed(
  () => editorOpen.value && JSON.stringify(payload.value) !== baseline.value,
)
const orderDirty = computed(
  () =>
    sorting.value &&
    JSON.stringify(orderItems.value.map((item) => item.id)) !== orderBaseline.value,
)
const dirty = computed(() => formDirty.value || orderDirty.value)
useUnsavedChanges(dirty)
const hasRealClaims = computed(
  () =>
    !form.value.isPlaceholder ||
    form.value.coverKind === 'screenshot' ||
    form.value.status !== 'unconfirmed' ||
    payload.value.techStack.length > 0 ||
    !!payload.value.demoUrl ||
    !!payload.value.repositoryUrl,
)
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return projects.value.filter(
    (project) =>
      (archivedFilter.value === 'all' ||
        (archivedFilter.value === 'archived' ? !!project.archivedAt : !project.archivedAt)) &&
      (!categoryFilter.value || project.category === categoryFilter.value) &&
      (!statusFilter.value || project.status === statusFilter.value) &&
      (!query ||
        `${project.name} ${project.slug} ${project.summary} ${project.techStack.join(' ')}`
          .toLocaleLowerCase()
          .includes(query)),
  )
})
const categoryName = (slug: string) =>
  categories.value.find((item) => item.slug === slug)?.name || slug

async function readLists() {
  const data = await admin.loadWorkspace()
  projects.value = data.projects
  categories.value = data.categories
  revision.value = data.revision
}
async function reload() {
  if (busy.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    await readLists()
    editorOpen.value = false
    sorting.value = false
    pendingAction.value = null
    conflict.value = false
    orderConflict.value = false
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    loading.value = false
  }
}
async function refreshAfterWrite() {
  try {
    await readLists()
  } catch (cause) {
    error.value = `保存已成功，但列表刷新失败：${errorText(cause)}。请重新加载列表。`
  }
}
function openEditor(project?: Project) {
  editingId.value = project?.id ?? null
  form.value = projectInput(project, categories.value[0]?.slug ?? '')
  techText.value = form.value.techStack.join('\n')
  baseline.value = JSON.stringify(payload.value)
  formRevision.value = revision.value
  idempotencyKey.value = project ? '' : newIdempotencyKey()
  editorOpen.value = true
  conflict.value = false
  comparison.value = null
  reviewed.value = false
  confirmedFacts.value = false
  error.value = ''
  success.value = ''
}
async function save() {
  if (busy.value) return
  error.value = ''
  success.value = ''
  if (!payload.value.cover.id) {
    error.value = '请选择项目封面。'
    return
  }
  if (payload.value.cover.kind === 'builtin' && payload.value.coverKind === 'screenshot') {
    error.value = '内置资源是占位封面，不能标记为真实截图。'
    return
  }
  if (
    payload.value.techStack.length > 20 ||
    payload.value.techStack.some((tag) => [...tag].length > 40) ||
    new Set(payload.value.techStack).size !== payload.value.techStack.length
  ) {
    error.value = '技术栈最多 20 项，每项最多 40 字且不能重复。'
    return
  }
  if (hasRealClaims.value && !confirmedFacts.value) {
    error.value = '请核实技术栈、状态、外链及截图后勾选事实确认。'
    return
  }
  if (conflict.value || (comparison.value && !reviewed.value)) return
  busy.value = true
  try {
    await admin.write<{ project: Project; revision: string }>(
      editingId.value ? 'PUT' : 'POST',
      editingId.value ? `/projects/${encodeURIComponent(editingId.value)}` : '/projects',
      payload.value,
      formRevision.value,
      editingId.value ? undefined : idempotencyKey.value,
    )
    editorOpen.value = false
    success.value = editingId.value
      ? '项目草稿已保存，公开网站尚未改变。'
      : '项目已创建并追加到草稿末尾。如需调整位置，请另行保存完整排序。'
    idempotencyKey.value = ''
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
  busy.value = true
  error.value = ''
  try {
    const data = await admin.loadWorkspace()
    projects.value = data.projects
    categories.value = data.categories
    revision.value = data.revision
    const current = editingId.value
      ? data.projects.find((item) => item.id === editingId.value)
      : undefined
    if (editingId.value && (!current || current.archivedAt)) {
      error.value = '此项目已被删除或归档，当前输入仍保留。请复制需要的内容，再放弃表单并重新加载。'
      return
    }
    if (keepInput) {
      comparison.value = current
        ? projectInput(current)
        : projectInput(undefined, categories.value[0]?.slug ?? '')
      formRevision.value = data.revision
      reviewed.value = false
      conflict.value = false
      success.value =
        '已读取最新版本，输入仍保留。请对照下方服务端内容，明确确认后再次保存；没有自动重试。'
    } else {
      openEditor(current)
      success.value = '已载入服务端最新值，之前未保存的输入已放弃。'
    }
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
function startOrdering() {
  orderItems.value = projects.value.filter((item) => !item.archivedAt)
  orderBaseline.value = JSON.stringify(orderItems.value.map((item) => item.id))
  orderRevision.value = revision.value
  orderConflict.value = false
  sorting.value = true
  editorOpen.value = false
}
function move(from: number, to: number) {
  orderItems.value = moveItem(orderItems.value, from, to)
}
function dragStart(event: DragEvent, id: string) {
  draggedId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function drop(target: string) {
  const from = orderItems.value.findIndex((item) => item.id === draggedId.value)
  const to = orderItems.value.findIndex((item) => item.id === target)
  move(from, to)
  draggedId.value = ''
}
async function saveOrder() {
  if (busy.value || !orderDirty.value || orderConflict.value) return
  busy.value = true
  error.value = ''
  try {
    await admin.write(
      'PUT',
      '/projects/order',
      { ids: orderItems.value.map((item) => item.id) },
      orderRevision.value,
    )
    sorting.value = false
    success.value = '全部未归档项目的顺序已在单个事务内保存。'
    await refreshAfterWrite()
  } catch (cause) {
    error.value = errorText(cause)
    if (cause instanceof ApiError && cause.code === 'REVISION_CONFLICT') orderConflict.value = true
  } finally {
    busy.value = false
  }
}
async function applyArchive() {
  if (busy.value) return
  const action = pendingAction.value
  if (!action) return
  busy.value = true
  error.value = ''
  try {
    await admin.write(
      'POST',
      `/projects/${encodeURIComponent(action.project.id)}/${action.type}`,
      {},
      action.revision,
    )
    pendingAction.value = null
    success.value =
      action.type === 'archive'
        ? '项目已归档并隐藏，媒体与历史记录仍保留。'
        : '项目已恢复到草稿，请重新检查是否在公开网站展示。'
    await refreshAfterWrite()
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
function setCover(value: AssetReference | null) {
  form.value.cover = value ?? { kind: 'builtin', id: '' }
}
function resetFilters() {
  search.value = ''
  categoryFilter.value = ''
  statusFilter.value = ''
  archivedFilter.value = 'all'
}
function sessionRestored(event: Event) {
  const current = (event as CustomEvent<{ revision?: string }>).detail?.revision
  if (!current || !/^ws-[0-9]+$/.test(current)) return
  if (editorOpen.value && current !== formRevision.value) {
    conflict.value = true
    comparison.value = null
    reviewed.value = false
    error.value = '登录已恢复，但工作区已有变化。项目输入与原始版本仍保留，请读取最新基准并核对。'
  } else if (sorting.value && current !== orderRevision.value) {
    orderConflict.value = true
    error.value = '登录已恢复，但排序基准已经改变。当前顺序仍保留，请重新加载完整列表后调整。'
  } else if (current !== revision.value) {
    error.value = '登录已恢复，工作区已有变化。请重新加载列表后继续操作。'
  }
}
onMounted(reload)
onMounted(() => window.addEventListener('xiaowork:session-restored', sessionRestored))
onBeforeUnmount(() => window.removeEventListener('xiaowork:session-restored', sessionRestored))
</script>

<template>
  <section class="admin-page stack" aria-labelledby="projects-title">
    <header class="page-header">
      <div>
        <p class="eyebrow">内容管理 / 草稿</p>
        <h1 id="projects-title" tabindex="-1">项目管理</h1>
        <p class="muted">编辑项目、封面与展示顺序。保存只更新私有草稿，不会直接发布。</p>
      </div>
      <div class="actions">
        <button class="button button--secondary" :disabled="busy || loading" @click="reload">
          {{ dirty ? '放弃未保存修改并重新加载' : '重新加载' }}
        </button>
        <button
          class="button button--secondary"
          :disabled="
            busy ||
            loading ||
            editorOpen ||
            dirty ||
            projects.filter((item) => !item.archivedAt).length < 2
          "
          @click="startOrdering"
        >
          调整项目顺序
        </button>
        <button
          class="button button--primary"
          :disabled="busy || loading || dirty || sorting || !categories.length"
          @click="openEditor()"
        >
          新增项目
        </button>
      </div>
    </header>
    <p v-if="error" role="alert" class="alert alert--error">{{ error }}</p>
    <p v-if="success" role="status" class="alert alert--success">{{ success }}</p>
    <p v-if="loading" role="status">正在读取项目草稿…</p>
    <p v-if="!loading && !categories.length" class="alert">
      请先在分类管理中新增分类，再创建项目。
    </p>

    <section v-if="pendingAction" class="panel stack" aria-label="确认归档操作">
      <h2>
        {{ pendingAction.type === 'archive' ? '归档项目' : '恢复项目' }}：{{
          pendingAction.project.name
        }}
      </h2>
      <p>
        {{
          pendingAction.type === 'archive'
            ? '归档会隐藏项目，但保留内容、媒体引用与历史。'
            : '恢复后仍是草稿，展示状态需要单独核查。'
        }}
      </p>
      <div class="actions">
        <button class="button button--primary" :disabled="busy" @click="applyArchive">
          确认{{ pendingAction.type === 'archive' ? '归档' : '恢复' }}</button
        ><button class="button button--secondary" :disabled="busy" @click="pendingAction = null">
          取消
        </button>
      </div>
      <p class="help-text">若提示版本冲突，请取消并重新加载列表后再次确认，不会自动覆盖。</p>
    </section>

    <section v-if="sorting" class="panel stack" aria-labelledby="project-order-title">
      <h2 id="project-order-title">项目完整排序</h2>
      <p class="help-text">
        包含全部未归档项目，与列表筛选无关。拖动条目或使用上移 / 下移，最后一次保存完整 ID
        顺序。新增项目与排序是两次独立操作。
      </p>
      <ol class="sort-list stack">
        <li
          v-for="(project, index) in orderItems"
          :key="project.id"
          class="panel toolbar"
          :draggable="!busy"
          @dragstart="dragStart($event, project.id)"
          @dragover.prevent
          @drop.prevent="drop(project.id)"
          @dragend="draggedId = ''"
        >
          <span>{{ index + 1 }}. {{ project.name }}</span>
          <div class="actions">
            <button
              class="button button--secondary"
              :disabled="busy || index === 0"
              :aria-label="`上移 ${project.name}`"
              @click="move(index, index - 1)"
            >
              上移</button
            ><button
              class="button button--secondary"
              :disabled="busy || index === orderItems.length - 1"
              :aria-label="`下移 ${project.name}`"
              @click="move(index, index + 1)"
            >
              下移
            </button>
          </div>
        </li>
      </ol>
      <p v-if="orderConflict" class="alert alert--error">
        顺序基准已过期，当前调整仍保留。请重新加载完整列表后调整，不会自动重试。
      </p>
      <div class="actions">
        <button
          class="button button--primary"
          :disabled="busy || !orderDirty || orderConflict"
          @click="saveOrder"
        >
          保存完整排序</button
        ><button class="button button--secondary" :disabled="busy" @click="sorting = false">
          放弃排序
        </button>
      </div>
    </section>

    <form
      v-if="editorOpen"
      class="panel stack"
      aria-labelledby="project-form-title"
      @submit.prevent="save"
    >
      <h2 id="project-form-title">{{ editingId ? '编辑项目' : '新增项目' }}</h2>
      <p class="help-text">
        基准版本
        {{ formRevision }}。未知信息请保留「待确认」、空技术栈及空外链；不要把占位封面标为截图。
      </p>
      <div class="form-grid">
        <label class="field"
          >项目名称<input
            v-model="form.name"
            required
            maxlength="80"
            autocomplete="off"
            :disabled="busy"
        /></label>
        <label class="field"
          >项目标识 slug<input
            v-model="form.slug"
            required
            maxlength="64"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            autocomplete="off"
            :disabled="busy"
          /><span class="help-text">小写字母、数字及单个连字符；例如 my-project。</span></label
        >
        <label class="field"
          >项目分类<select v-model="form.category" required :disabled="busy">
            <option value="" disabled>请选择分类</option>
            <option v-for="category in categories" :key="category.id" :value="category.slug">
              {{ category.name }}
            </option>
          </select></label
        >
        <label class="field"
          >项目状态<select v-model="form.status" :disabled="busy">
            <option v-for="status in projectStatuses" :key="status.value" :value="status.value">
              {{ status.label }}
            </option>
          </select></label
        >
      </div>
      <label class="field"
        >项目简介<textarea
          v-model="form.summary"
          required
          maxlength="500"
          rows="3"
          :disabled="busy"
        />
      </label>
      <label class="field"
        >项目详情<textarea
          v-model="form.description"
          maxlength="20000"
          rows="6"
          :disabled="busy"
        /><span class="help-text">纯文本，最多 20,000 字，不执行 HTML。</span></label
      >
      <label class="field"
        >项目技术栈<textarea v-model="techText" rows="3" :disabled="busy" /><span class="help-text"
          >每行或逗号分隔一项，最多 20 项；未知时留空。</span
        ></label
      >
      <div class="form-grid">
        <label class="field"
          >官网公开地址（可选）<input
            v-model="form.demoUrl"
            type="url"
            maxlength="2048"
            pattern="https://.*"
            placeholder="仅填写已确认的公开 HTTPS 地址"
            :disabled="busy"
        /></label>
        <label class="field"
          >GitHub 源码地址（可选）<input
            v-model="form.repositoryUrl"
            type="url"
            maxlength="2048"
            pattern="https://.*"
            placeholder="尚未确认请留空"
            :disabled="busy"
        /></label>
      </div>
      <div class="check-list">
        <label class="checkbox-field"
          ><input
            v-model="form.visible"
            type="checkbox"
            :disabled="busy"
          />在公开项目列表中展示（发布后生效）</label
        >
        <label class="checkbox-field"
          ><input v-model="form.featured" type="checkbox" :disabled="busy" />设为首页精选项目</label
        >
        <label class="checkbox-field"
          ><input
            v-model="form.isPlaceholder"
            type="checkbox"
            :disabled="busy"
          />项目资料仍含占位信息</label
        >
      </div>
      <AssetPicker
        :model-value="form.cover.id ? form.cover : null"
        label="项目封面"
        allow-builtin
        :disabled="busy"
        @update:model-value="setCover"
      />
      <div class="form-grid">
        <label class="field"
          >封面类型<select v-model="form.coverKind" :disabled="busy">
            <option value="placeholder">明确占位资源</option>
            <option value="screenshot">已确认的真实截图</option>
          </select></label
        >
        <label class="field"
          >封面替代文本<input v-model="form.coverAlt" required maxlength="200" :disabled="busy"
        /></label>
      </div>
      <label v-if="hasRealClaims" class="checkbox-field"
        ><input
          v-model="confirmedFacts"
          type="checkbox"
          :disabled="busy"
        />我已核实填写的状态、技术栈、地址和截图，未把未知信息当作真实资料。</label
      >
      <div v-if="conflict" class="alert alert--error stack" role="alert">
        <p>工作区已被其他操作更新。当前表单完整保留，没有自动重试。</p>
        <div class="actions">
          <button
            type="button"
            class="button button--secondary"
            :disabled="busy"
            @click="resolveConflict(false)"
          >
            放弃输入，载入最新项目</button
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
      <details v-if="comparison" open class="panel">
        <summary>服务端最新内容（请与当前输入核对）</summary>
        <pre>{{ JSON.stringify(comparison, null, 2) }}</pre>
        <label class="checkbox-field"
          ><input
            v-model="reviewed"
            type="checkbox"
          />我已完成对照，确认再次保存会用当前完整表单替换此项目的最新值。</label
        >
      </details>
      <div class="actions">
        <button
          type="submit"
          class="button button--primary"
          :disabled="busy || conflict || (!!comparison && !reviewed)"
        >
          {{ busy ? '正在保存…' : '保存项目草稿' }}</button
        ><button
          type="button"
          class="button button--secondary"
          :disabled="busy"
          @click="editorOpen = false"
        >
          放弃此表单
        </button>
      </div>
    </form>

    <section v-if="!sorting" class="panel stack" aria-label="项目列表">
      <div class="toolbar">
        <label class="field"
          >搜索项目<input v-model="search" type="search" placeholder="名称、slug、简介或技术栈"
        /></label>
        <label class="field"
          >分类筛选<select v-model="categoryFilter">
            <option value="">全部分类</option>
            <option v-for="category in categories" :key="category.id" :value="category.slug">
              {{ category.name }}
            </option>
          </select></label
        >
        <label class="field"
          >状态筛选<select v-model="statusFilter">
            <option value="">全部状态</option>
            <option v-for="status in projectStatuses" :key="status.value" :value="status.value">
              {{ status.label }}
            </option>
          </select></label
        >
        <label class="field"
          >归档筛选<select v-model="archivedFilter">
            <option value="active">未归档</option>
            <option value="archived">已归档</option>
            <option value="all">全部项目</option>
          </select></label
        >
      </div>
      <p role="status" class="help-text">
        显示 {{ filtered.length }} / {{ projects.length }} 个项目。窄屏可横向滚动表格查看操作。
      </p>
      <div
        v-if="filtered.length"
        class="table-wrap"
        role="region"
        aria-label="项目列表横向滚动区域"
        tabindex="0"
      >
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">项目</th>
              <th scope="col">分类 / 状态</th>
              <th scope="col">展示</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="project in filtered" :key="project.id">
              <td>
                <strong>{{ project.name }}</strong>
                <p class="muted">{{ project.slug }}</p>
                <p>{{ project.summary }}</p>
                <span v-if="project.isPlaceholder" class="badge">资料含占位</span>
              </td>
              <td>
                {{ categoryName(project.category) }}
                <p>
                  <span class="badge">{{ statusLabel(project.status) }}</span
                  ><span v-if="project.archivedAt" class="badge">已归档</span>
                </p>
              </td>
              <td>
                {{ project.visible ? '展示' : '隐藏' }}
                <p v-if="project.featured">首页精选</p>
              </td>
              <td>
                <div class="actions">
                  <button
                    v-if="!project.archivedAt"
                    class="button button--secondary"
                    :disabled="busy || dirty || !!pendingAction"
                    :aria-label="`编辑 ${project.name}`"
                    @click="openEditor(project)"
                  >
                    编辑</button
                  ><button
                    class="button button--secondary"
                    :disabled="busy || dirty || !!pendingAction"
                    :aria-label="`${project.archivedAt ? '恢复' : '归档'} ${project.name}`"
                    @click="
                      pendingAction = {
                        project,
                        type: project.archivedAt ? 'restore' : 'archive',
                        revision,
                      }
                    "
                  >
                    {{ project.archivedAt ? '恢复' : '归档' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="!loading" class="empty-state">
        <p>没有符合当前条件的项目。</p>
        <button class="button button--secondary" @click="resetFilters">清除筛选</button>
      </div>
    </section>
  </section>
</template>
