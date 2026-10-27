import { createRouter, createWebHistory } from 'vue-router'
import { admin } from './lib/admin'
import { confirmUnsavedChanges } from './composables/useUnsavedChanges'
import LoginPage from './pages/LoginPage.vue'
import DashboardPage from './pages/DashboardPage.vue'
import ProjectsPage from './pages/ProjectsPage.vue'
import CategoriesPage from './pages/CategoriesPage.vue'
import MediaPage from './pages/MediaPage.vue'
import ProfilePage from './pages/ProfilePage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import PasswordPage from './pages/PasswordPage.vue'

let restored = false
export const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/login', name: 'login', component: LoginPage, meta: { title: '管理员登录' } },
    { path: '/', name: 'dashboard', component: DashboardPage, meta: { title: '工作区概览' } },
    { path: '/projects', name: 'projects', component: ProjectsPage, meta: { title: '项目管理' } },
    {
      path: '/categories',
      name: 'categories',
      component: CategoriesPage,
      meta: { title: '项目分类' },
    },
    { path: '/media', name: 'media', component: MediaPage, meta: { title: '图片资源' } },
    {
      path: '/profile',
      name: 'profile',
      component: ProfilePage,
      meta: { title: '品牌与个人资料' },
    },
    { path: '/settings', name: 'settings', component: SettingsPage, meta: { title: '网站与 SEO' } },
    { path: '/account', name: 'password', component: PasswordPage, meta: { title: '修改密码' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})
router.beforeEach(async (to, from) => {
  if (!restored) {
    try {
      await admin.restore()
    } catch (cause) {
      admin.notice.value =
        cause instanceof Error ? cause.message : '管理服务暂时不可用，请稍后重试。'
    }
    restored = true
  }
  if (from.name && to.fullPath !== from.fullPath && !confirmUnsavedChanges()) return false
  if (!admin.session.value && to.name !== 'login')
    return { name: 'login', query: { next: to.fullPath } }
  if (admin.session.value && to.name === 'login') return { name: 'dashboard' }
  return true
})
router.afterEach((to, _from, failure) => {
  if (failure) return
  document.title = `${String(to.meta.title ?? '内容管理')} · XiaoWork`
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>('main h1')
    heading?.setAttribute('tabindex', '-1')
    heading?.focus({ preventScroll: true })
  })
})
