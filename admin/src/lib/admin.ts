import { ref, shallowRef } from 'vue'
import { ApiClient, ApiError } from './api.ts'
import type { MediaResult, Session, Workspace, WriteMethod } from './types.ts'

function validSession(value: Session): boolean {
  return (
    value?.administrator?.id === 1 &&
    typeof value.administrator.username === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.csrfToken) &&
    [value.expiresAt, value.idleExpiresAt, value.reauthUntil].every(
      (date) => typeof date === 'string' && Number.isFinite(Date.parse(date)),
    )
  )
}

export function createAdmin(client = new ApiClient()) {
  const session = shallowRef<Session | null>(null)
  const workspace = shallowRef<Workspace | null>(null)
  const notice = ref('')
  const authExpired = ref(false)
  let authGeneration = 0
  let workspaceReadSequence = 0
  client.onUnauthorized = () => {
    authGeneration++
    session.value = null
    authExpired.value = true
    notice.value = '登录已失效。未保存的表单会保留，请重新登录后确认版本。'
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('xiaowork:session-expired'))
  }

  function acceptSession(value: Session) {
    if (!validSession(value)) throw new ApiError(0, 'INVALID_SESSION', '会话响应无效，请重新登录。')
    client.setCSRF(value.csrfToken)
    session.value = value
    authExpired.value = false
    notice.value = ''
  }

  async function restore(): Promise<boolean> {
    const generation = authGeneration
    try {
      const restored = await client.request<Session>('GET', '/auth/session', undefined, {
        notifyUnauthorized: session.value !== null,
      })
      if (generation !== authGeneration) return session.value !== null
      acceptSession(restored)
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (generation !== authGeneration) return session.value !== null
        session.value = null
        client.setCSRF('')
        return false
      }
      throw error
    }
  }

  async function login(username: string, password: string): Promise<void> {
    authGeneration++
    const challenge = await client.request<{ loginNonce: string; expiresAt: string }>(
      'GET',
      '/auth/login-challenge',
    )
    acceptSession(
      await client.request<Session>(
        'POST',
        '/auth/login',
        { username, password },
        { csrf: challenge.loginNonce, notifyUnauthorized: false },
      ),
    )
  }

  function clearAccount() {
    authGeneration++
    client.setCSRF('')
    session.value = null
    workspace.value = null
    authExpired.value = false
  }

  async function logout(): Promise<void> {
    try {
      await client.request<void>('POST', '/auth/logout')
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
    }
    clearAccount()
    notice.value = '已退出登录。'
  }

  async function changePassword(
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<void> {
    await client.request<void>('POST', '/auth/password', {
      currentPassword,
      newPassword,
      confirmPassword,
    })
    clearAccount()
    notice.value = '密码已修改，全部旧会话已失效。请重新登录。'
  }

  async function reauth(password: string): Promise<void> {
    const result = await client.request<{ reauthUntil: string }>('POST', '/auth/reauth', {
      password,
    })
    if (session.value) session.value = { ...session.value, reauthUntil: result.reauthUntil }
  }

  async function loadWorkspace(): Promise<Workspace> {
    const generation = authGeneration
    const sequence = ++workspaceReadSequence
    const value = await client.request<Workspace>('GET', '/workspace')
    if (generation === authGeneration && sequence === workspaceReadSequence && session.value)
      workspace.value = value
    return value
  }

  return {
    session,
    workspace,
    notice,
    authExpired,
    restore,
    login,
    logout,
    changePassword,
    reauth,
    loadWorkspace,
    get: <T>(path: string) => client.request<T>('GET', path),
    write: <T>(
      method: WriteMethod,
      path: string,
      body: unknown,
      revision: string,
      idempotencyKey?: string,
    ) => client.write<T>(method, path, body, revision, idempotencyKey),
    upload: (
      file: File,
      revision: string,
      onProgress?: (percent: number) => void,
    ): Promise<MediaResult> => client.upload(file, revision, onProgress),
  }
}

/** Private in-memory state only: never serialize this store or its CSRF to web storage. */
export const admin = createAdmin()
