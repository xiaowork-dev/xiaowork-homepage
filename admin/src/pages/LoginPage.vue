<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { admin } from '../lib/admin'
import { ApiError } from '../lib/api'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ authenticated: [] }>()
const router = useRouter(),
  route = useRoute()
const username = ref(''),
  password = ref(''),
  showPassword = ref(false)
const busy = ref(false),
  error = ref(''),
  retryAfter = ref<number | null>(null)
const usernameInput = ref<HTMLInputElement | null>(null)
async function login() {
  if (busy.value) return
  error.value = ''
  retryAfter.value = null
  busy.value = true
  try {
    await admin.login(username.value, password.value)
    password.value = ''
    emit('authenticated')
    if (!props.embedded) {
      const next = typeof route.query.next === 'string' ? route.query.next : '/'
      await router.replace(
        next.startsWith('/') && !next.startsWith('//') && next !== '/login' ? next : '/',
      )
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败，请稍后重试。'
    if (cause instanceof ApiError && cause.status === 429)
      retryAfter.value = cause.retryAfter ?? null
    password.value = ''
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  await nextTick()
  usernameInput.value?.focus()
})
</script>

<template>
  <section :class="embedded ? 'login-embedded' : 'login-page'">
    <div class="login-card panel">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">X</span
        ><span>XiaoWork <small>内容管理</small></span>
      </div>
      <span class="eyebrow">PRIVATE WORKSPACE</span>
      <h1>{{ embedded ? '重新验证身份' : '欢迎回来' }}</h1>
      <p class="muted">
        {{
          embedded
            ? '当前页面和未保存输入仍然保留。登录后请检查草稿版本，再继续保存。'
            : '管理作品与品牌内容，让每一次更新都有据可循。'
        }}
      </p>
      <div v-if="error" class="alert alert--error" role="alert">
        {{ error }}
        <p v-if="retryAfter">建议 {{ retryAfter }} 秒后再试。请勿连续重复提交。</p>
      </div>
      <form class="stack" @submit.prevent="login">
        <label class="field"
          >管理员账户<input
            ref="usernameInput"
            v-model="username"
            name="username"
            autocomplete="username"
            required
            maxlength="80"
            :disabled="busy"
        /></label>
        <label class="field"
          >密码<span class="password-field"
            ><input
              v-model="password"
              name="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              required
              :disabled="busy"
            /><button
              type="button"
              class="password-toggle"
              :aria-pressed="showPassword"
              :disabled="busy"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? '隐藏' : '显示' }}
            </button></span
          ></label
        >
        <button
          class="button button--primary button--wide"
          :disabled="busy || !username || !password"
        >
          {{ busy ? '正在验证…' : '安全登录' }} <span aria-hidden="true">→</span>
        </button>
      </form>
      <p class="help-text login-help">
        仅限已初始化的管理员。没有公开注册或默认密码。登录凭据不会保存到浏览器存储。
      </p>
    </div>
    <p v-if="!embedded" class="login-footer">XiaoWork · Developer & Creator</p>
  </section>
</template>
