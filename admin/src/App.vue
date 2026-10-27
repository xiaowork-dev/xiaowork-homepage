<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { admin } from './lib/admin'
import {
  allowNextNavigation,
  confirmUnsavedChanges,
  hasUnsavedChanges,
} from './composables/useUnsavedChanges'
import AdminIcon from './components/AdminIcon.vue'
import LoginPage from './pages/LoginPage.vue'

const route = useRoute(),
  router = useRouter()
const drawer = ref<HTMLDialogElement | null>(null),
  sessionDialog = ref<HTMLDialogElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null),
  logoutBusy = ref(false),
  appError = ref('')
const theme = ref(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
const isLogin = computed(() => route.name === 'login')
const navigation = [
  { to: '/', label: '工作区概览', icon: 'dashboard' },
  { to: '/projects', label: '项目管理', icon: 'projects' },
  { to: '/categories', label: '项目分类', icon: 'categories' },
  { to: '/media', label: '图片资源', icon: 'media' },
  { to: '/profile', label: '品牌与个人资料', icon: 'profile' },
  { to: '/settings', label: '网站与 SEO', icon: 'settings' },
]
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.value
  try {
    localStorage.setItem('xiaowork-admin-theme', theme.value)
  } catch {
    /* Theme still works without storage. */
  }
}
function closeDrawer() {
  drawer.value?.close()
  menuButton.value?.focus()
}
async function logout() {
  if (logoutBusy.value || !confirmUnsavedChanges()) return
  logoutBusy.value = true
  appError.value = ''
  try {
    await admin.logout()
    allowNextNavigation()
    await router.replace('/login')
  } catch (cause) {
    appError.value = cause instanceof Error ? cause.message : '退出失败，请稍后重试。'
  } finally {
    logoutBusy.value = false
    drawer.value?.close()
  }
}
async function resumed() {
  sessionDialog.value?.close()
  admin.notice.value =
    '身份已恢复。当前表单保留原始版本；如果其他操作已改变草稿，保存时会提示冲突，请先核对。'
  try {
    const workspace = await admin.loadWorkspace()
    window.dispatchEvent(
      new CustomEvent('xiaowork:session-restored', { detail: { revision: workspace.revision } }),
    )
  } catch (cause) {
    appError.value = cause instanceof Error ? cause.message : '读取工作区版本失败，请稍后重试。'
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (hasUnsavedChanges()) {
    event.preventDefault()
    event.returnValue = ''
  }
}
watch(
  () => route.fullPath,
  () => {
    drawer.value?.close()
  },
)
watch([() => admin.authExpired.value, isLogin], async ([expired, login]) => {
  await nextTick()
  if (expired && !login && !sessionDialog.value?.open) sessionDialog.value?.showModal()
  else sessionDialog.value?.close()
})
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <a href="#main-content" class="skip-link">跳到主要内容</a>
  <div v-if="isLogin" class="login-shell">
    <button
      class="button button--ghost login-theme"
      :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
      @click="toggleTheme"
    >
      <AdminIcon :name="theme === 'dark' ? 'sun' : 'moon'" /><span>{{
        theme === 'dark' ? '浅色' : '深色'
      }}</span>
    </button>
    <div v-if="admin.notice.value" class="alert login-notice" role="status">
      {{ admin.notice.value }}
    </div>
    <main id="main-content"><RouterView /></main>
  </div>
  <div v-else class="admin-shell">
    <aside class="sidebar" aria-label="管理导航">
      <RouterLink to="/" class="brand-lockup sidebar-brand"
        ><span class="brand-mark" aria-hidden="true">X</span
        ><span>XiaoWork<small>内容管理工作区</small></span></RouterLink
      >
      <div class="sidebar-group-label">工作空间</div>
      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          :exact-active-class="item.to === '/' ? 'is-active' : undefined"
          active-class="is-active"
          ><AdminIcon :name="item.icon" />{{ item.label }}</RouterLink
        >
      </nav>
      <div class="sidebar-group-label">账户</div>
      <nav class="sidebar-nav">
        <RouterLink to="/account" active-class="is-active"
          ><AdminIcon name="shield" />修改密码</RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <span class="badge">私有草稿环境</span>
        <p>保存属于创作，发布另有确认。</p>
        <a href="/" target="_blank" rel="noopener noreferrer"
          ><AdminIcon name="link" />查看访客网站<span class="sr-only">（新窗口）</span></a
        >
      </div>
    </aside>
    <div class="workspace-shell">
      <header class="topbar">
        <div class="topbar-start">
          <button
            ref="menuButton"
            class="button button--ghost mobile-menu-button"
            aria-label="打开管理菜单"
            aria-haspopup="dialog"
            @click="drawer?.showModal()"
          >
            <AdminIcon name="menu" />
          </button>
          <div class="breadcrumb">
            <span>工作空间</span><span aria-hidden="true">/</span
            ><strong>{{ route.meta.title }}</strong>
          </div>
        </div>
        <div class="topbar-actions">
          <button
            class="button button--ghost theme-button"
            :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
            @click="toggleTheme"
          >
            <AdminIcon :name="theme === 'dark' ? 'sun' : 'moon'" /><span>{{
              theme === 'dark' ? '浅色' : '深色'
            }}</span></button
          ><span class="user-chip" :title="admin.session.value?.administrator.username"
            ><span class="user-avatar" aria-hidden="true">{{
              admin.session.value?.administrator.username.slice(0, 1).toUpperCase() ?? 'X'
            }}</span
            ><span>{{ admin.session.value?.administrator.username ?? '会话失效' }}</span></span
          ><button
            class="button button--ghost logout-button"
            :disabled="logoutBusy"
            @click="logout"
          >
            <AdminIcon name="logout" /><span>{{ logoutBusy ? '退出中' : '退出' }}</span>
          </button>
        </div>
      </header>
      <main id="main-content" class="main-content">
        <div v-if="appError" class="alert alert--error" role="alert">{{ appError }}</div>
        <div v-if="admin.notice.value && !admin.authExpired.value" class="alert" role="status">
          {{ admin.notice.value }}
        </div>
        <RouterView />
      </main>
      <footer class="workspace-footer">
        <span>XiaoWork · 内容管理</span><span>草稿先行，审阅后发布。</span>
      </footer>
    </div>
    <dialog
      ref="drawer"
      class="mobile-drawer"
      aria-labelledby="drawer-title"
      @click="$event.target === drawer && closeDrawer()"
    >
      <div class="drawer-heading">
        <strong id="drawer-title">XiaoWork 管理菜单</strong
        ><button class="button button--ghost" aria-label="关闭管理菜单" @click="closeDrawer">
          <AdminIcon name="close" />
        </button>
      </div>
      <nav class="sidebar-nav">
        <RouterLink v-for="item in navigation" :key="item.to" :to="item.to" active-class="is-active"
          ><AdminIcon :name="item.icon" />{{ item.label }}</RouterLink
        ><RouterLink to="/account" active-class="is-active"
          ><AdminIcon name="shield" />修改密码</RouterLink
        >
      </nav>
      <div class="drawer-footer">
        <span class="badge">私有草稿环境</span
        ><button class="button button--secondary" :disabled="logoutBusy" @click="logout">
          退出登录
        </button>
      </div>
    </dialog>
  </div>
  <dialog
    ref="sessionDialog"
    class="session-dialog"
    aria-label="登录已失效，保留当前表单"
    @cancel.prevent
  >
    <LoginPage embedded @authenticated="resumed" />
  </dialog>
</template>
