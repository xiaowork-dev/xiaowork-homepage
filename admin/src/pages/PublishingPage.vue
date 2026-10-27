<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { admin } from '../lib/admin'
import { ApiError, newIdempotencyKey } from '../lib/api'
import {
  canCreatePublication,
  pendingJob,
  publicationJobLabel,
  safePreviewURL,
  isReviewCurrent,
  isActiveReviewCurrent,
} from '../lib/publishing'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import type {
  PublicationJob,
  PublicationKind,
  PublishedRelease,
  PublishingStatus,
  Workspace,
} from '../lib/types'

const status = ref<PublishingStatus | null>(null)
const workspace = ref<Workspace | null>(null)
const jobs = ref<PublicationJob[]>([])
const releases = ref<PublishedRelease[]>([])
const selectedJob = ref<PublicationJob | null>(null)
const loading = ref(false),
  busy = ref(false),
  authenticating = ref(false)
const error = ref(''),
  message = ref(''),
  password = ref('')
const publishConfirmed = ref(false),
  rollbackConfirmed = ref(false),
  targetRelease = ref('')
const publishReviewedActive = ref<string | null | undefined>(undefined)
const rollbackReviewedActive = ref<string | null | undefined>(undefined)
watch(
  publishConfirmed,
  (checked) => {
    publishReviewedActive.value = checked ? status.value?.activeReleaseId : undefined
  },
  { flush: 'sync' },
)
watch(
  rollbackConfirmed,
  (checked) => {
    rollbackReviewedActive.value = checked ? status.value?.activeReleaseId : undefined
  },
  { flush: 'sync' },
)
const refreshRequired = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined
const now = ref(Date.now())
let stopped = false
let intent: {
  kind: PublicationKind
  key: string
  revision: string
  target: string
  active: string | null
} | null = null

useUnsavedChanges(
  computed(() => !!password.value || publishConfirmed.value || rollbackConfirmed.value),
)
const available = computed(
  () =>
    canCreatePublication(status.value) && !loading.value && !busy.value && !refreshRequired.value,
)
const validWorkspace = computed(
  () => workspace.value?.initialized === true && !workspace.value.validation,
)
const review = computed(() => status.value?.review)
const reviewReady = computed(() => isReviewCurrent(review.value, workspace.value?.revision))
const restoreTarget = computed(() =>
  releases.value.find(
    (item) =>
      item.id === targetRelease.value &&
      item.kind === 'publication' &&
      item.verified &&
      !item.active,
  ),
)
const recentAuthentication = computed(
  () => !!admin.session.value && Date.parse(admin.session.value.reauthUntil) > now.value,
)
const reviewGroups = computed(() => [
  { label: '新增展示', items: review.value?.added ?? [] },
  { label: '修改与调整顺序', items: review.value?.modified ?? [] },
  { label: '隐藏', items: review.value?.hidden ?? [] },
  { label: '归档', items: review.value?.archived ?? [] },
])
const kindLabels: Record<string, string> = {
  publish: '全站发布',
  preview: '私有预览',
  rollback: '恢复公开版本',
}
const phaseLabels: Record<string, string> = {
  building: '构建静态页面',
  validating: '检查页面与资源',
  prepared: '候选版本已就绪',
  activating: '切换与独立核验',
  preview: '准备私有预览',
  recovery_required: '需要恢复核对',
}

function readableTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间不可用'
    : date.toLocaleString('zh-CN', { hour12: false })
}
function previewLink(release: PublishedRelease) {
  if (
    release.kind !== 'preview' ||
    !release.verified ||
    !release.expiresAt ||
    Date.parse(release.expiresAt) <= now.value
  )
    return null
  return safePreviewURL(release.previewUrl)
}
function stopPoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = undefined
}
function schedulePoll() {
  stopPoll()
  if (!stopped && selectedJob.value && pendingJob(selectedJob.value))
    pollTimer = setTimeout(() => {
      void pollJob()
    }, 2500)
}
async function load() {
  if (busy.value || loading.value) return
  loading.value = true
  error.value = ''
  message.value = ''
  stopPoll()
  publishConfirmed.value = false
  rollbackConfirmed.value = false
  password.value = ''
  intent = null
  try {
    const [capability, draft] = await Promise.all([
      admin.get<PublishingStatus>('/publishing-status'),
      admin.loadWorkspace(),
    ])
    status.value = capability
    workspace.value = draft
    refreshRequired.value = false
    if (capability.enabled === true && capability.localOnly === true) {
      const [jobList, releaseList] = await Promise.all([
        admin.get<{ items: PublicationJob[] }>('/jobs'),
        admin.get<{ items: PublishedRelease[] }>('/releases'),
      ])
      jobs.value = jobList.items
      releases.value = releaseList.items
      selectedJob.value =
        capability.blockingJob ??
        (selectedJob.value
          ? (jobs.value.find((job) => job.id === selectedJob.value?.id) ?? null)
          : null)
    } else {
      jobs.value = []
      releases.value = []
      selectedJob.value = null
    }
  } catch (cause) {
    status.value = null
    error.value = cause instanceof Error ? cause.message : '读取发布状态失败；操作保持禁用。'
  } finally {
    loading.value = false
    schedulePoll()
  }
}
async function pollJob() {
  const id = selectedJob.value?.id
  if (busy.value || !id || !/^job_[0-9a-f]{32}$/.test(id)) return
  try {
    const [result, capability] = await Promise.all([
      admin.get<{ job: PublicationJob }>('/jobs/' + id),
      admin.get<PublishingStatus>('/publishing-status'),
    ])
    if (stopped || selectedJob.value?.id !== id) return
    selectedJob.value = result.job
    status.value = capability
    const index = jobs.value.findIndex((job) => job.id === id)
    if (index >= 0) jobs.value[index] = result.job
    else jobs.value.unshift(result.job)
    if (!pendingJob(result.job)) {
      releases.value = (await admin.get<{ items: PublishedRelease[] }>('/releases')).items
      message.value =
        result.job.status === 'succeeded'
          ? result.job.kind === 'preview'
            ? '预览已构建。只有登录状态且未到期时可以打开，不改变公开站点。'
            : capability.activeVerified && capability.activeReleaseId === result.job.releaseId
              ? '本地静态站当前版本已通过独立核验；生产服务器未改变。'
              : '任务已结束，当前静态版本尚未核验一致。请先重新读取状态。'
          : '任务未成功。请查看错误摘要；重新提交前先核对任务和实际静态版本。'
      if (
        result.job.kind !== 'preview' &&
        result.job.status === 'succeeded' &&
        (!capability.activeVerified || capability.activeReleaseId !== result.job.releaseId)
      )
        refreshRequired.value = true
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取任务失败；不能据此判断发布结果。'
    refreshRequired.value = true
    return
  }
  schedulePoll()
}
async function inspectJob(job: PublicationJob) {
  stopPoll()
  selectedJob.value = job
  await pollJob()
}
function selectRestore(release: PublishedRelease) {
  targetRelease.value = release.id
  rollbackConfirmed.value = false
}
async function reauthenticate() {
  if (!password.value || authenticating.value) return
  authenticating.value = true
  error.value = ''
  try {
    await admin.reauth(password.value)
    message.value = '身份已再次验证。请继续核对全站更新或恢复范围。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '身份验证失败。'
  } finally {
    password.value = ''
    authenticating.value = false
  }
}
async function create(kind: PublicationKind) {
  if (!available.value || !workspace.value) return
  if (kind !== 'rollback' && !validWorkspace.value) return
  if (
    kind === 'publish' &&
    (!reviewReady.value ||
      !publishConfirmed.value ||
      !isActiveReviewCurrent(publishReviewedActive.value, status.value))
  )
    return
  if (
    kind === 'rollback' &&
    (!restoreTarget.value ||
      !rollbackConfirmed.value ||
      !isActiveReviewCurrent(rollbackReviewedActive.value, status.value))
  )
    return
  if (kind !== 'preview' && !recentAuthentication.value) {
    error.value = '发布和恢复前，请重新验证当前密码。'
    return
  }
  const target = kind === 'rollback' ? targetRelease.value : ''
  const active =
    kind === 'preview'
      ? null
      : ((kind === 'publish' ? publishReviewedActive.value : rollbackReviewedActive.value) ?? null)
  if (
    intent &&
    (intent.kind !== kind ||
      intent.revision !== workspace.value.revision ||
      intent.target !== target ||
      intent.active !== active)
  ) {
    error.value = '已有提交意图。请先重新读取任务与草稿，避免重复操作。'
    return
  }
  intent ??= { kind, key: newIdempotencyKey(), revision: workspace.value.revision, target, active }
  let conflictMessage = ''
  busy.value = true
  error.value = ''
  message.value = ''
  stopPoll()
  try {
    const result = await admin.write<{ jobId: string; snapshotId: string; status: string }>(
      'POST',
      '/' + kind + '-jobs',
      {
        ...(kind === 'rollback' ? { targetReleaseId: target } : {}),
        ...(kind !== 'preview'
          ? { confirmAllChanges: true, reviewedActiveReleaseId: intent.active }
          : {}),
      },
      intent.revision,
      intent.key,
    )
    if (!/^job_[0-9a-f]{32}$/.test(result.jobId) || result.status !== 'queued')
      throw new Error('任务响应无效。请重新读取任务列表确认，勿重复提交。')
    publishConfirmed.value = false
    rollbackConfirmed.value = false
    message.value = '服务器已接收任务并排队；这不代表公开版本已更新。'
    const resultJob = await admin.get<{ job: PublicationJob }>('/jobs/' + result.jobId)
    selectedJob.value = resultJob.job
    jobs.value.unshift(resultJob.job)
    intent = null
    status.value = await admin.get<PublishingStatus>('/publishing-status')
  } catch (cause) {
    if (cause instanceof ApiError && [403, 409, 428, 503].includes(cause.status))
      refreshRequired.value = true
    error.value = cause instanceof Error ? cause.message : '提交结果未知。请先重新读取任务列表。'
    if (cause instanceof ApiError && cause.status === 409) conflictMessage = error.value
    if (!(cause instanceof ApiError) || cause.status === 0) refreshRequired.value = true
  } finally {
    busy.value = false
    schedulePoll()
  }
  if (conflictMessage) {
    await load()
    error.value =
      conflictMessage +
      (error.value
        ? ' ' + error.value
        : ' 已重新读取草稿与活动版本。请重新核对并确认，旧请求不会自动重试。')
  }
}
onMounted(() => {
  void load()
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 5000)
})
onBeforeUnmount(() => {
  stopped = true
  stopPoll()
  if (clockTimer) clearInterval(clockTimer)
  password.value = ''
})
</script>

<template>
  <div class="admin-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">REVIEW & RELEASE</span>
        <h1>发布、预览与历史</h1>
        <p class="muted">草稿与静态站分开管理。此处仅支持独立本地验收，正式网站不会被修改。</p>
      </div>
      <button class="button button--secondary" :disabled="loading || busy" @click="load">
        {{ loading ? '正在读取…' : '重新读取草稿与发布状态' }}
      </button>
    </header>
    <div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
    <div v-if="message" class="alert" role="status">{{ message }}</div>
    <section class="panel form-section" aria-labelledby="publication-gate-title">
      <div class="section-heading">
        <h2 id="publication-gate-title">发布门槛</h2>
        <span class="badge">{{
          status?.enabled && status.localOnly ? '独立本地环境' : '操作未启用'
        }}</span>
      </div>
      <p class="muted">
        {{ status?.reason ?? '尚未获得后端可用状态。预览、发布和恢复保持禁用。' }}
      </p>
      <dl class="summary-list">
        <div>
          <dt>构建服务</dt>
          <dd>{{ status?.workerAvailable ? '已连接' : '不可用' }}</dd>
        </div>
        <div>
          <dt>已核对草稿</dt>
          <dd>
            <code>{{ workspace?.revision ?? '尚未读取' }}</code>
          </dd>
        </div>
        <div>
          <dt>当前静态版本</dt>
          <dd>
            <code>{{ status?.activeReleaseId ?? '尚无已激活版本' }}</code>
          </dd>
        </div>
        <div>
          <dt>当前版本核验</dt>
          <dd>
            {{
              status?.activeVerified
                ? '已核验一致'
                : status?.activeReleaseId
                  ? '未核验，禁止新发布'
                  : '首次发布前无活动版本'
            }}
          </dd>
        </div>
      </dl>
      <p v-if="status?.blockingJob" class="help-text">
        已有任务处理中或需要恢复核对，不能并发启动新任务。
      </p>
      <p v-if="refreshRequired" class="help-text">
        状态已变化或请求结果不明确。请先点「重新读取草稿与发布状态」核对，不能直接再次提交。
      </p>
    </section>
    <section class="panel form-section" aria-labelledby="publication-review-title">
      <h2 id="publication-review-title">核对本次全站更新</h2>
      <p class="muted">
        发布包含此版本所有项目、品牌资料、分类、文案、SEO 和已确认图片。不是只发布某一张项目卡片。
      </p>
      <template v-if="reviewReady"
        ><dl class="summary-list">
          <div v-for="group in reviewGroups" :key="group.label">
            <dt>{{ group.label }}</dt>
            <dd>
              {{ group.items.length }} 项：{{
                group.items.map((item) => item.name).join('、') || '无'
              }}
            </dd>
          </div>
          <div>
            <dt>品牌与个人资料</dt>
            <dd>{{ review?.profileChanged ? '有变化' : '无变化' }}</dd>
          </div>
          <div>
            <dt>分类名称与顺序</dt>
            <dd>{{ review?.categoriesChanged ? '有变化' : '无变化' }}</dd>
          </div>
          <div>
            <dt>网站与 SEO</dt>
            <dd>{{ review?.settingsChanged ? '有变化' : '无变化' }}</dd>
          </div>
          <div>
            <dt>公开图片资源</dt>
            <dd>{{ review?.mediaChanged ? '有变化' : '无变化' }}</dd>
          </div>
        </dl></template
      >
      <p v-else class="alert">
        尚无法对照当前静态版本核验完整草稿差异，或摘要版本已落后。全站发布保持禁用。
      </p>
      <p v-if="!validWorkspace" class="help-text">
        草稿尚未初始化或未通过验证；请先补齐项目、资料与设置。
      </p>
      <label class="checkbox-field"
        ><input
          v-model="publishConfirmed"
          type="checkbox"
          :disabled="!available || !reviewReady || !validWorkspace"
        />我已核对上述全站变化；发布整个草稿版本到本地静态站，不会连接正式服务器。</label
      >
      <div class="actions">
        <button
          class="button button--secondary"
          :disabled="!available || !validWorkspace"
          @click="create('preview')"
        >
          构建私有预览</button
        ><button
          class="button button--primary"
          :disabled="
            !available ||
            !validWorkspace ||
            !reviewReady ||
            !publishConfirmed ||
            !isActiveReviewCurrent(publishReviewedActive, status) ||
            !recentAuthentication
          "
          @click="create('publish')"
        >
          {{ busy ? '提交中…' : '确认全站本地发布' }}
        </button>
      </div>
      <p class="help-text">
        预览不切换当前版本，所有页面和图片均需登录且有有效期。发布会按正式路由重新构建，不把预览目录直接提升为公开版。
      </p>
    </section>
    <section class="panel form-section" aria-labelledby="publication-reauth-title">
      <h2 id="publication-reauth-title">发布与恢复前再次验证</h2>
      <p class="help-text">
        {{
          recentAuthentication
            ? '最近身份验证仍有效。'
            : '输入当前密码完成短时身份确认，密码不会保存。'
        }}
      </p>
      <form class="reauth-form" @submit.prevent="reauthenticate">
        <label class="field"
          >当前密码<input
            v-model="password"
            type="password"
            autocomplete="current-password"
            maxlength="128"
            :disabled="authenticating || busy"
        /></label>
        <div class="actions">
          <button class="button button--secondary" :disabled="!password || authenticating || busy">
            {{ authenticating ? '正在验证…' : '验证当前密码' }}
          </button>
        </div>
      </form>
    </section>
    <section class="panel form-section" aria-labelledby="publication-task-title">
      <h2 id="publication-task-title">任务状态</h2>
      <div v-if="selectedJob" class="form-section">
        <p>
          <strong
            >{{ kindLabels[selectedJob.kind] ?? '任务' }} ·
            {{ publicationJobLabel(selectedJob) }}</strong
          >
        </p>
        <dl class="summary-list">
          <div>
            <dt>任务</dt>
            <dd>
              <code>{{ selectedJob.id }}</code>
            </dd>
          </div>
          <div>
            <dt>冻结草稿版本</dt>
            <dd>{{ selectedJob.workspaceRevision }}</dd>
          </div>
          <div>
            <dt>处理阶段</dt>
            <dd>{{ phaseLabels[selectedJob.phase ?? ''] ?? '等待或核对中' }}</dd>
          </div>
          <div>
            <dt>完成时间</dt>
            <dd>{{ readableTime(selectedJob.completedAt) }}</dd>
          </div>
        </dl>
        <p v-if="selectedJob.error" class="alert alert--error">
          {{ selectedJob.error.message }}（{{ selectedJob.error.code }}）
        </p>
        <p v-if="pendingJob(selectedJob)" class="help-text" role="status">
          正在轮询真实服务端状态；离开本页不会取消已经接收的任务。
        </p>
        <button class="button button--secondary" :disabled="busy" @click="pollJob">
          读取任务最新状态
        </button>
      </div>
      <ul v-if="jobs.length" class="publication-list">
        <li v-for="job in jobs" :key="job.id">
          <div>
            <strong>{{ kindLabels[job.kind] ?? job.kind }}</strong>
            <p class="help-text">{{ job.workspaceRevision }} · {{ publicationJobLabel(job) }}</p>
            <code>{{ job.id }}</code>
          </div>
          <time :datetime="job.createdAt">{{ readableTime(job.createdAt) }}</time
          ><button class="button button--secondary" :disabled="busy" @click="inspectJob(job)">
            查看任务
          </button>
        </li>
      </ul>
      <p v-else class="empty-state">暂无可读取的任务；保存草稿不会自动生成发布任务。</p>
    </section>
    <section class="panel form-section" aria-labelledby="publication-history-title">
      <h2 id="publication-history-title">保留版本与私有预览</h2>
      <p class="muted">
        恢复只切换已成功并完整保留的静态产物，不覆盖当前草稿、账户或数据库。预览不能作为恢复目标。
      </p>
      <ul v-if="releases.length" class="publication-list">
        <li v-for="release in releases" :key="release.id">
          <div>
            <strong
              >{{ release.kind === 'preview' ? '私有预览' : '静态版本'
              }}{{ release.active ? ' · 当前版本' : '' }}</strong
            >
            <p class="help-text">
              {{ release.workspaceRevision }} ·
              {{ release.verified ? '资源核验通过' : '未核验或产物不可用' }}
            </p>
            <code>{{ release.id }}</code>
            <p v-if="release.expiresAt" class="help-text">
              预览截止 {{ readableTime(release.expiresAt) }}
            </p>
          </div>
          <a
            v-if="previewLink(release)"
            :href="previewLink(release) ?? undefined"
            class="button button--secondary"
            target="_blank"
            rel="noopener noreferrer"
            >打开私有预览<span class="sr-only">（新窗口，仍需登录）</span></a
          ><button
            v-if="release.kind === 'publication'"
            class="button button--secondary"
            :disabled="!available || !release.verified || release.active"
            @click="selectRestore(release)"
          >
            选择恢复此版本
          </button>
        </li>
      </ul>
      <p v-else class="empty-state">尚无可用的保留版本。</p>
      <template v-if="restoreTarget"
        ><h3>确认恢复范围</h3>
        <p class="help-text">
          目标版本：<code>{{ restoreTarget.id }}</code
          >。恢复整个本地静态站，当前草稿 {{ workspace?.revision }} 将保留。
        </p>
        <label class="checkbox-field"
          ><input
            v-model="rollbackConfirmed"
            type="checkbox"
            :disabled="!available"
          />我确认恢复所选完整公开内容版本，并保留当前草稿。</label
        ><button
          class="button button--secondary"
          :disabled="
            !available ||
            !rollbackConfirmed ||
            !recentAuthentication ||
            !isActiveReviewCurrent(rollbackReviewedActive, status)
          "
          @click="create('rollback')"
        >
          确认本地恢复
        </button></template
      >
    </section>
  </div>
</template>

<style scoped>
.publication-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.publication-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
}
.publication-list li > div {
  min-width: 0;
}
.publication-list time {
  font-size: 12px;
  color: var(--muted);
}
.summary-list dt {
  flex-shrink: 0;
}
.summary-list dd {
  min-width: 0;
  overflow-wrap: anywhere;
}
.reauth-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 16px;
}
@media (max-width: 600px) {
  .publication-list li {
    display: flex;
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }
  .summary-list > div {
    flex-direction: column;
    gap: 5px;
  }
  .summary-list dd {
    text-align: left;
  }
  .reauth-form {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
