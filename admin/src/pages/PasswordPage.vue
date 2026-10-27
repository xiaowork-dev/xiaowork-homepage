<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { admin } from '../lib/admin'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
const current = ref(''),
  password = ref(''),
  confirm = ref(''),
  show = ref(false),
  busy = ref(false),
  error = ref('')
const router = useRouter()
const dirty = computed(() => Boolean(current.value || password.value || confirm.value))
useUnsavedChanges(dirty)
async function save() {
  const length = [...password.value].length
  error.value = ''
  if (length < 12 || length > 128 || new TextEncoder().encode(password.value).length > 1024) {
    error.value = '新密码需要 12～128 个字符，且 UTF-8 编码不超过 1,024 字节。'
    return
  }
  if (password.value !== confirm.value) {
    error.value = '两次输入的新密码不一致。'
    return
  }
  busy.value = true
  try {
    await admin.changePassword(current.value, password.value, confirm.value)
    current.value = ''
    password.value = ''
    confirm.value = ''
    admin.notice.value = '密码已更新，所有旧会话已失效。请使用新密码重新登录。'
    await router.replace('/login')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '修改失败，请稍后重试。'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="admin-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">ACCOUNT SECURITY</span>
        <h1>修改密码</h1>
        <p class="muted">更新管理员密码，保护你的私有工作区。</p>
      </div>
    </header>
    <div class="alert alert--warning">
      修改成功后，所有浏览器和设备上的现有会话都会失效，需要重新登录。请先保存其他标签页的草稿。
    </div>
    <form class="panel form-section password-panel" @submit.prevent="save">
      <div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
      <label class="field"
        >当前密码<input
          v-model="current"
          :type="show ? 'text' : 'password'"
          autocomplete="current-password"
          required
          :disabled="busy" /></label
      ><label class="field"
        >新密码<input
          v-model="password"
          :type="show ? 'text' : 'password'"
          autocomplete="new-password"
          required
          :disabled="busy"
        /><span class="help-text">12～128 个字符。不会自动去除空格，请妥善保存。</span></label
      ><label class="field"
        >再次输入新密码<input
          v-model="confirm"
          :type="show ? 'text' : 'password'"
          autocomplete="new-password"
          required
          :disabled="busy" /></label
      ><label class="checkbox-field"><input v-model="show" type="checkbox" />显示密码</label
      ><button class="button button--primary" :disabled="busy || !current || !password || !confirm">
        {{ busy ? '正在更新…' : '修改密码并退出所有会话' }}
      </button>
    </form>
  </div>
</template>
