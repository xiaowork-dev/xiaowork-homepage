<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { admin } from '../lib/admin'
import { ApiError } from '../lib/api'
import { errorText, moveItem } from '../lib/content'
import type { Category } from '../lib/types'

const categories = ref<Category[]>([])
const revision = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const success = ref('')
const editing = ref(false)
const editingId = ref<string | null>(null)
const name = ref('')
const slug = ref('')
const formRevision = ref('')
const baseline = ref('')
const conflict = ref(false)
const latest = ref<Category | null>(null)
const rebased = ref(false)
const reviewed = ref(false)
const pendingDelete = ref<Category | null>(null)
const deleteRevision = ref('')
const sorting = ref(false)
const order = ref<Category[]>([])
const orderBaseline = ref('')
const orderRevision = ref('')
const orderConflict = ref(false)
const draggedId = ref('')
const formDirty = computed(
  () => editing.value && JSON.stringify({ name: name.value, slug: slug.value }) !== baseline.value,
)
const orderDirty = computed(
  () => sorting.value && JSON.stringify(order.value.map((item) => item.id)) !== orderBaseline.value,
)
const dirty = computed(() => formDirty.value || orderDirty.value)
useUnsavedChanges(dirty)

async function readCategories() {
  const workspace = await admin.loadWorkspace()
  categories.value = workspace.categories
  revision.value = workspace.revision
}
async function reload() {
  if (busy.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    await readCategories()
    editing.value = false
    sorting.value = false
    pendingDelete.value = null
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
    await readCategories()
  } catch (cause) {
    error.value = `保存已成功，但分类列表刷新失败：${errorText(cause)}。请重新加载。`
  }
}
function openForm(category?: Category) {
  editingId.value = category?.id ?? null
  name.value = category?.name ?? ''
  slug.value = category?.slug ?? ''
  baseline.value = JSON.stringify({ name: name.value, slug: slug.value })
  formRevision.value = revision.value
  editing.value = true
  conflict.value = false
  latest.value = null
  rebased.value = false
  reviewed.value = false
  error.value = ''
  success.value = ''
}
async function save() {
  if (busy.value) return
  if (conflict.value || (rebased.value && !reviewed.value)) return
  busy.value = true
  error.value = ''
  try {
    await admin.write(
      editingId.value ? 'PUT' : 'POST',
      editingId.value ? `/categories/${encodeURIComponent(editingId.value)}` : '/categories',
      editingId.value ? { name: name.value } : { name: name.value, slug: slug.value },
      formRevision.value,
    )
    editing.value = false
    success.value = '分类草稿已保存。新分类会追加到末尾，顺序需另行保存。'
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
    const workspace = await admin.loadWorkspace()
    categories.value = workspace.categories
    revision.value = workspace.revision
    const current = editingId.value
      ? workspace.categories.find((category) => category.id === editingId.value)
      : undefined
    if (editingId.value && !current) {
      error.value = '分类已不存在，输入仍保留。请复制需要的内容，再放弃表单。'
      return
    }
    if (keepInput) {
      latest.value = current ?? null
      formRevision.value = workspace.revision
      conflict.value = false
      rebased.value = true
      reviewed.value = false
      success.value = '已读取最新基准并保留输入，请核对后明确确认，再次保存。'
    } else {
      openForm(current)
      success.value = '已放弃旧输入并载入服务端最新值。'
    }
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
function askDelete(category: Category) {
  pendingDelete.value = category
  deleteRevision.value = revision.value
  error.value = ''
}
async function remove() {
  if (busy.value) return
  const category = pendingDelete.value
  if (!category) return
  busy.value = true
  error.value = ''
  try {
    await admin.write(
      'DELETE',
      `/categories/${encodeURIComponent(category.id)}`,
      undefined,
      deleteRevision.value,
    )
    pendingDelete.value = null
    success.value = '未被引用的分类已删除。'
    await refreshAfterWrite()
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    busy.value = false
  }
}
function startOrdering() {
  order.value = [...categories.value]
  orderBaseline.value = JSON.stringify(order.value.map((item) => item.id))
  orderRevision.value = revision.value
  orderConflict.value = false
  sorting.value = true
  editing.value = false
}
function move(from: number, to: number) {
  order.value = moveItem(order.value, from, to)
}
function dragStart(event: DragEvent, id: string) {
  draggedId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function drop(target: string) {
  move(
    order.value.findIndex((item) => item.id === draggedId.value),
    order.value.findIndex((item) => item.id === target),
  )
  draggedId.value = ''
}
async function saveOrder() {
  if (busy.value || !orderDirty.value || orderConflict.value) return
  busy.value = true
  error.value = ''
  try {
    await admin.write(
      'PUT',
      '/categories/order',
      { ids: order.value.map((item) => item.id) },
      orderRevision.value,
    )
    sorting.value = false
    success.value = '全部分类的完整顺序已在单个事务内保存。'
    await refreshAfterWrite()
  } catch (cause) {
    error.value = errorText(cause)
    if (cause instanceof ApiError && cause.code === 'REVISION_CONFLICT') orderConflict.value = true
  } finally {
    busy.value = false
  }
}
function sessionRestored(event: Event) {
  const current = (event as CustomEvent<{ revision?: string }>).detail?.revision
  if (!current || !/^ws-[0-9]+$/.test(current)) return
  if (editing.value && current !== formRevision.value) {
    conflict.value = true
    latest.value = null
    rebased.value = false
    reviewed.value = false
    error.value = '登录已恢复，但工作区已有变化。分类输入与原始版本仍保留，请读取最新基准并核对。'
  } else if (sorting.value && current !== orderRevision.value) {
    orderConflict.value = true
    error.value = '登录已恢复，但排序基准已改变。当前顺序仍保留，请重新加载全部分类后调整。'
  } else if (current !== revision.value) {
    error.value = '登录已恢复，工作区已有变化。请重新加载分类后继续操作。'
  }
}
onMounted(reload)
onMounted(() => window.addEventListener('xiaowork:session-restored', sessionRestored))
onBeforeUnmount(() => window.removeEventListener('xiaowork:session-restored', sessionRestored))
</script>

<template>
  <section class="admin-page stack" aria-labelledby="categories-title">
    <header class="page-header">
      <div>
        <p class="eyebrow">内容管理 / 草稿</p>
        <h1 id="categories-title" tabindex="-1">分类管理</h1>
        <p class="muted">稳定标识供项目引用；修改分类名称不会改变 slug。</p>
      </div>
      <div class="actions">
        <button class="button button--secondary" :disabled="busy || loading" @click="reload">
          {{ dirty ? '放弃未保存修改并重新加载' : '重新加载' }}</button
        ><button
          class="button button--secondary"
          :disabled="busy || loading || dirty || editing || categories.length < 2"
          @click="startOrdering"
        >
          调整分类顺序</button
        ><button
          class="button button--primary"
          :disabled="busy || loading || dirty || sorting"
          @click="openForm()"
        >
          新增分类
        </button>
      </div>
    </header>
    <p v-if="error" role="alert" class="alert alert--error">{{ error }}</p>
    <p v-if="success" role="status" class="alert alert--success">{{ success }}</p>
    <p v-if="loading" role="status">正在读取分类…</p>
    <section v-if="pendingDelete" class="panel stack" aria-label="确认删除分类">
      <h2>删除分类：{{ pendingDelete.name }}</h2>
      <p>此操作删除未被引用的分类。被任何项目引用的分类不能删除，请先调整项目分类。</p>
      <div class="actions">
        <button class="button button--danger" :disabled="busy" @click="remove">确认删除分类</button
        ><button class="button button--secondary" :disabled="busy" @click="pendingDelete = null">
          取消
        </button>
      </div>
      <p class="help-text">若提示引用或版本冲突，请取消并重新加载，不会自动重试。</p>
    </section>

    <form
      v-if="editing"
      class="panel stack"
      aria-labelledby="category-form-title"
      @submit.prevent="save"
    >
      <h2 id="category-form-title">{{ editingId ? '编辑分类' : '新增分类' }}</h2>
      <p class="help-text">基准版本 {{ formRevision }}，保存仅影响草稿。</p>
      <div class="form-grid">
        <label class="field"
          >分类名称<input v-model="name" required maxlength="80" :disabled="busy" /></label
        ><label class="field"
          >分类标识 slug<input
            v-model="slug"
            required
            maxlength="64"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            :disabled="busy || !!editingId"
          /><span class="help-text">创建后不能修改，使用小写字母、数字及连字符。</span></label
        >
      </div>
      <div v-if="conflict" class="alert alert--error stack" role="alert">
        <p>工作区版本冲突，表单输入已保留，没有自动重试。</p>
        <div class="actions">
          <button
            type="button"
            class="button button--secondary"
            :disabled="busy"
            @click="resolveConflict(false)"
          >
            放弃输入，载入最新分类</button
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
      <div v-if="rebased" class="panel stack">
        <p>
          服务端最新值：{{
            latest
              ? `${latest.name}（${latest.slug}）`
              : '当前是新建分类；保存仍需通过标识唯一性校验。'
          }}
        </p>
        <label class="checkbox-field"
          ><input v-model="reviewed" type="checkbox" />我已核对最新值，确认再次提交当前输入。</label
        >
      </div>
      <div class="actions">
        <button
          type="submit"
          class="button button--primary"
          :disabled="busy || conflict || (rebased && !reviewed)"
        >
          {{ busy ? '正在保存…' : '保存分类草稿' }}</button
        ><button
          type="button"
          class="button button--secondary"
          :disabled="busy"
          @click="editing = false"
        >
          放弃此表单
        </button>
      </div>
    </form>

    <section v-if="sorting" class="panel stack" aria-labelledby="category-order-title">
      <h2 id="category-order-title">分类完整排序</h2>
      <p class="help-text">
        拖动条目或使用键盘上移 / 下移。保存会提交全部分类 ID，在单个事务内调整。
      </p>
      <ol class="sort-list stack">
        <li
          v-for="(category, index) in order"
          :key="category.id"
          class="panel toolbar"
          :draggable="!busy"
          @dragstart="dragStart($event, category.id)"
          @dragover.prevent
          @drop.prevent="drop(category.id)"
          @dragend="draggedId = ''"
        >
          <span>{{ index + 1 }}. {{ category.name }}</span>
          <div class="actions">
            <button
              class="button button--secondary"
              :disabled="busy || index === 0"
              :aria-label="`上移 ${category.name}`"
              @click="move(index, index - 1)"
            >
              上移</button
            ><button
              class="button button--secondary"
              :disabled="busy || index === order.length - 1"
              :aria-label="`下移 ${category.name}`"
              @click="move(index, index + 1)"
            >
              下移
            </button>
          </div>
        </li>
      </ol>
      <p v-if="orderConflict" class="alert alert--error">
        排序基准过期，当前调整已保留。请重新加载全部分类后调整，不会自动重试。
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

    <section v-else class="panel stack" aria-label="分类列表">
      <div v-if="categories.length" class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">分类</th>
              <th scope="col">稳定标识</th>
              <th scope="col">项目引用</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="category in categories" :key="category.id">
              <td>
                <strong>{{ category.name }}</strong>
              </td>
              <td>{{ category.slug }}</td>
              <td>{{ category.projectCount }}</td>
              <td>
                <div class="actions">
                  <button
                    class="button button--secondary"
                    :disabled="busy || dirty || !!pendingDelete"
                    :aria-label="`编辑 ${category.name}`"
                    @click="openForm(category)"
                  >
                    编辑</button
                  ><button
                    class="button button--danger"
                    :disabled="busy || dirty || !!pendingDelete || category.projectCount > 0"
                    :aria-label="`删除 ${category.name}`"
                    @click="askDelete(category)"
                  >
                    删除
                  </button>
                </div>
                <p v-if="category.projectCount > 0" class="help-text">有项目引用，不能删除。</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else-if="!loading" class="empty-state">暂无分类，请先新增分类。</p>
    </section>
  </section>
</template>
