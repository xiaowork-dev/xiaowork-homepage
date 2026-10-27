<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { admin } from '../lib/admin'
import type { Dashboard } from '../lib/types'
const data = ref<Dashboard | null>(null),
  loading = ref(false),
  error = ref('')
const labels: Record<string, string> = {
  'project.create': '新增项目',
  'project.update': '编辑项目',
  'project.archive': '归档项目',
  'project.restore': '恢复项目',
  'projects.order': '调整项目顺序',
  'category.create': '新增分类',
  'category.update': '编辑分类',
  'category.delete': '删除分类',
  'categories.order': '调整分类顺序',
  'profile.update': '更新品牌资料',
  'settings.update': '更新网站设置',
  'media.upload': '上传图片',
  'media.update': '更新图片信息',
  'media.delete': '软删除图片',
  'administrator.initialize': '初始化管理员账户',
  'administrator.offline-reset': '离线重置管理员密码',
  'authentication.login': '管理员登录',
  'authentication.logout': '退出登录',
  'authentication.reauthenticate': '再次验证管理员密码',
  'authentication.password-change': '修改管理员密码',
  'authentication.rate-limited': '登录验证触发限速',
  'content.import': '导入初始网站资料',
}
const resources: Record<string, string> = {
  administrator: '管理员账户',
  session: '登录会话',
  workspace: '工作区草稿',
  project: '项目',
  category: '项目分类',
  media: '图片素材',
  profile: '品牌资料',
  settings: '网站设置',
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await admin.get<Dashboard>('/dashboard')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取失败，请重试。'
  } finally {
    loading.value = false
  }
}
function time(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间不可用'
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
}
onMounted(load)
</script>
<template>
  <div class="admin-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">YOUR CREATIVE WORKSPACE</span>
        <h1>工作区概览</h1>
        <p class="muted">
          你好，{{
            admin.session.value?.administrator.username ?? '管理员'
          }}。从这里整理你的下一次更新。
        </p>
      </div>
      <button class="button button--secondary" :disabled="loading" @click="load">
        {{ loading ? '正在刷新…' : '刷新概览' }}
      </button>
    </header>
    <div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
    <p v-if="loading && !data" class="panel" role="status">正在读取工作区…</p>
    <template v-if="data">
      <div class="workspace-banner">
        <div>
          <span class="badge">私有草稿</span>
          <h2>把想法打磨成下一次更新</h2>
          <p>所有编辑都会保存到草稿，并记录版本。公开网站不会随着编辑立即改变。</p>
          <RouterLink to="/projects" class="button button--primary"
            >管理项目 <span aria-hidden="true">↗</span></RouterLink
          >
        </div>
        <div class="workspace-symbol" aria-hidden="true">
          <span>〈</span><b>X</b><span>〉</span>
        </div>
      </div>
      <section class="stats-grid" aria-label="草稿统计">
        <div class="panel stat">
          <span class="muted">未归档项目</span><strong>{{ data.counts.projects }}</strong
          ><small>草稿项目总数</small>
        </div>
        <div class="panel stat">
          <span class="muted">配置为展示</span><strong>{{ data.counts.visibleProjects }}</strong
          ><small>尚未等同公开发布</small>
        </div>
        <div class="panel stat">
          <span class="muted">精选项目</span><strong>{{ data.counts.featuredProjects }}</strong
          ><small>草稿中可见且精选</small>
        </div>
        <div class="panel stat">
          <span class="muted">项目分类</span><strong>{{ data.counts.categories }}</strong
          ><small>用于项目归类</small>
        </div>
      </section>
      <div class="dashboard-grid">
        <section class="panel form-section">
          <div class="section-heading">
            <h2>公开发布状态</h2>
            <span class="badge badge--warning">尚未接入</span>
          </div>
          <p class="muted">
            发布 worker 将在 P6-D
            实现。当前无法核验公开版本、已发布项目数及草稿差异；这里不会把草稿统计当作公开结果。
          </p>
          <dl class="summary-list">
            <div>
              <dt>工作区版本</dt>
              <dd>
                <code>{{ data.revision }}</code>
              </dd>
            </div>
            <div>
              <dt>公开版本</dt>
              <dd>尚未核验</dd>
            </div>
            <div>
              <dt>已发布项目</dt>
              <dd>暂无可信统计</dd>
            </div>
          </dl>
          <div class="actions">
            <button class="button button--secondary" disabled>预览 · P6-D</button
            ><button class="button button--primary" disabled>发布 · P6-D</button
            ><button class="button button--secondary" disabled>历史恢复 · P6-D</button>
          </div>
        </section>
        <section class="panel form-section">
          <h2>内容维护</h2>
          <p class="muted">
            真实项目资料仍待补充。占位封面、技术栈和上线状态不会被自动标记为已经确认。
          </p>
          <nav class="quick-links" aria-label="内容管理快捷入口">
            <RouterLink to="/projects"
              ><span>项目与精选</span><span aria-hidden="true">→</span></RouterLink
            ><RouterLink to="/media"
              ><span>私有图片资源</span><span aria-hidden="true">→</span></RouterLink
            ><RouterLink to="/profile"
              ><span>品牌与个人资料</span><span aria-hidden="true">→</span></RouterLink
            ><RouterLink to="/settings"
              ><span>网站与 SEO</span><span aria-hidden="true">→</span></RouterLink
            >
          </nav>
        </section>
      </div>
      <section class="panel form-section">
        <div class="section-heading">
          <h2>最近操作</h2>
          <span class="muted">最多 20 条</span>
        </div>
        <ol v-if="data.recentEvents.length" class="activity-list">
          <li v-for="(event, index) in data.recentEvents" :key="index">
            <span class="activity-dot" aria-hidden="true" />
            <div>
              <strong>{{ labels[event.action] ?? '其他管理操作' }}</strong>
              <p class="help-text">
                {{ resources[event.resourceType] ?? '管理内容' }}
              </p>
            </div>
            <span class="badge">{{
              event.outcome === 'success' ? '成功' : event.outcome === 'denied' ? '已拒绝' : '失败'
            }}</span
            ><time :datetime="event.createdAt">{{ time(event.createdAt) }}</time>
          </li>
        </ol>
        <p v-else class="empty-state">还没有操作记录。保存内容后，可在这里查看最近修改。</p>
      </section>
    </template>
  </div>
</template>
