import type { MediaResult, WriteMethod } from './types.ts'

export const API_PREFIX = '/api/admin/v1'
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const REVISION = /^ws-(0|[1-9][0-9]{0,15})$/
const IDEMPOTENCY = /^[A-Za-z0-9_-]{16,128}$/
const MEDIA_CONTENT = /^\/api\/admin\/v1\/media\/med_[0-9a-f]{32}\/content$/

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly currentRevision: string | undefined
  readonly retryAfter: number | null
  readonly fields: unknown[]
  constructor(
    status: number,
    code: string,
    message: string,
    currentRevision?: string,
    retryAfter: number | null = null,
    fields: unknown[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.currentRevision = currentRevision
    this.retryAfter = retryAfter
    this.fields = fields
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function retrySeconds(value: string | null): number | null {
  if (!value) return null
  if (/^[0-9]+$/.test(value)) return Math.min(Number(value), 86400)
  const date = Date.parse(value)
  return Number.isFinite(date)
    ? Math.max(0, Math.min(86400, Math.ceil((date - Date.now()) / 1000)))
    : null
}

export function responseError(
  status: number,
  payload: unknown,
  retry: string | null = null,
): ApiError {
  const value = record(payload) && record(payload.error) ? payload.error : {}
  const code =
    typeof value.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.code)
      ? value.code
      : 'HTTP_ERROR'
  const message =
    typeof value.message === 'string' && value.message.length <= 1000
      ? value.message
      : status === 401
        ? '登录已失效，请重新登录。'
        : '管理服务返回异常，请稍后重试。'
  const revision =
    typeof value.currentRevision === 'string' && REVISION.test(value.currentRevision)
      ? value.currentRevision
      : undefined
  return new ApiError(
    status,
    code,
    message,
    revision,
    retrySeconds(retry),
    Array.isArray(value.fields) ? value.fields : [],
  )
}

export function normalizeApiPath(path: string): string {
  if (
    !/^\/[A-Za-z0-9/_-]*(?:\?[^#\s]*)?$/.test(path) ||
    path.includes('//') ||
    hasControlCharacters(path) ||
    path.includes('\\')
  ) {
    throw new ApiError(0, 'INVALID_API_PATH', '管理接口地址无效。')
  }
  return API_PREFIX + path
}

/** Only the exact authenticated media-content route may be rendered as an image. */
export function safeMediaURL(value: unknown): string | null {
  return typeof value === 'string' && MEDIA_CONTENT.test(value) ? value : null
}

export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return 'intent_' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function validateUploadFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size < 1) return '请选择非空图片文件。'
  if (file.size > 10 * 1024 * 1024) return '图片不得超过 10 MiB。'
  if (hasControlCharacters(file.name) || /[/\\:<>]/.test(file.name) || file.name.length > 255)
    return '图片文件名无效。'
  const name = file.name.toLowerCase()
  if (
    (file.type === 'image/png' && name.endsWith('.png')) ||
    (file.type === 'image/jpeg' && /\.jpe?g$/.test(name)) ||
    (file.type === 'image/webp' && name.endsWith('.webp'))
  )
    return null
  return '仅支持格式与扩展名一致的 PNG、JPEG 和 WebP 图片；不能上传 SVG、GIF 或 AVIF。'
}

interface RequestOptions {
  revision?: string
  idempotencyKey?: string
  csrf?: string
  signal?: AbortSignal
  timeout?: number
  notifyUnauthorized?: boolean
}

interface ClientOptions {
  fetcher?: typeof fetch
  xhrFactory?: () => XMLHttpRequest
  onUnauthorized?: () => void
}

export class ApiClient {
  private csrf = ''
  private authVersion = 0
  private readonly fetcher: typeof fetch
  private readonly xhrFactory: () => XMLHttpRequest
  onUnauthorized: (() => void) | undefined

  constructor(options: ClientOptions = {}) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
    this.xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest())
    this.onUnauthorized = options.onUnauthorized
  }

  setCSRF(value: string): void {
    if (value !== '' && !TOKEN.test(value))
      throw new ApiError(0, 'INVALID_SESSION', '会话安全令牌无效，请重新登录。')
    this.csrf = value
    this.authVersion++
  }

  private headers(method: string, body: unknown, options: RequestOptions): Headers {
    const headers = new Headers({ Accept: 'application/json' })
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = options.csrf ?? this.csrf
      if (!TOKEN.test(csrf)) throw new ApiError(401, 'AUTH_REQUIRED', '请先登录后再操作。')
      headers.set('X-CSRF-Token', csrf)
    }
    if (options.revision !== undefined) {
      if (!REVISION.test(options.revision))
        throw new ApiError(0, 'REVISION_REQUIRED', '请先读取有效的工作区版本。')
      headers.set('If-Match', '"' + options.revision + '"')
    }
    if (options.idempotencyKey !== undefined) {
      if (!IDEMPOTENCY.test(options.idempotencyKey))
        throw new ApiError(0, 'INVALID_IDEMPOTENCY_KEY', '创建操作标识无效。')
      headers.set('Idempotency-Key', options.idempotencyKey)
    }
    return headers
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const target = normalizeApiPath(path)
    const headers = this.headers(method, body, options)
    const authVersion = this.authVersion
    let serialized: string | undefined
    try {
      serialized = body === undefined ? undefined : JSON.stringify(body)
    } catch {
      throw new ApiError(0, 'INVALID_REQUEST', '提交内容无法编码，请检查表单。')
    }
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeout ?? 35000)
    const onAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await this.fetcher(target, {
        method,
        headers,
        body: serialized,
        credentials: 'same-origin',
        mode: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
      if (response.status === 204) return undefined as T
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        const error = responseError(response.status, payload, response.headers.get('Retry-After'))
        // A rejected current password does not revoke an otherwise valid session.
        const rejectedCredentialCheck =
          error.code === 'INVALID_CREDENTIALS' &&
          (path === '/auth/password' || path === '/auth/reauth')
        if (
          response.status === 401 &&
          !rejectedCredentialCheck &&
          options.notifyUnauthorized !== false &&
          authVersion === this.authVersion
        ) {
          this.setCSRF('')
          this.onUnauthorized?.()
        }
        throw error
      }
      if (!record(payload) || !Object.hasOwn(payload, 'data'))
        throw new ApiError(
          response.status,
          'INVALID_RESPONSE',
          '管理服务响应格式无效，请重新读取状态。',
        )
      return payload.data as T
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (timedOut)
        throw new ApiError(
          0,
          'REQUEST_TIMEOUT',
          '请求超时。请先重新读取状态，确认是否已保存，再决定重试。',
        )
      if (options.signal?.aborted) throw new ApiError(0, 'REQUEST_CANCELLED', '请求已取消。')
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        '无法连接管理服务，请检查本地 HTTPS 信任和网络后重试。',
      )
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  write<T>(
    method: WriteMethod,
    path: string,
    body: unknown,
    revision: string,
    idempotencyKey?: string,
  ): Promise<T> {
    if (!revision)
      return Promise.reject(new ApiError(428, 'REVISION_REQUIRED', '保存前需要明确的工作区版本。'))
    return this.request<T>(method, path, body, { revision, idempotencyKey })
  }

  upload(
    file: File,
    revision: string,
    onProgress?: (percent: number) => void,
  ): Promise<MediaResult> {
    const invalid = validateUploadFile(file)
    if (invalid) return Promise.reject(new ApiError(422, 'VALIDATION_FAILED', invalid))
    if (!revision)
      return Promise.reject(new ApiError(428, 'REVISION_REQUIRED', '上传前需要明确的工作区版本。'))
    let headers: Headers
    try {
      headers = this.headers('POST', undefined, { revision })
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const authVersion = this.authVersion
      const xhr = this.xhrFactory()
      xhr.open('POST', normalizeApiPath('/media'))
      xhr.withCredentials = true
      xhr.timeout = 45000
      xhr.responseType = 'json'
      for (const [key, value] of headers) xhr.setRequestHeader(key, value)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress?.(Math.min(99, Math.floor((event.loaded / event.total) * 100)))
      }
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          if (xhr.status === 401 && authVersion === this.authVersion) {
            this.setCSRF('')
            this.onUnauthorized?.()
          }
          reject(responseError(xhr.status, xhr.response, xhr.getResponseHeader('Retry-After')))
          return
        }
        const payload: unknown = xhr.response
        if (
          !record(payload) ||
          !record(payload.data) ||
          !record(payload.data.media) ||
          !safeMediaURL(payload.data.media.contentUrl) ||
          typeof payload.data.revision !== 'string' ||
          !REVISION.test(payload.data.revision)
        ) {
          reject(
            new ApiError(xhr.status, 'INVALID_RESPONSE', '图片服务响应无效，请重新读取素材列表。'),
          )
          return
        }
        onProgress?.(100)
        resolve(payload.data as unknown as MediaResult)
      }
      xhr.onerror = () =>
        reject(new ApiError(0, 'NETWORK_ERROR', '图片上传连接失败，请重新读取素材列表确认结果。'))
      xhr.ontimeout = () =>
        reject(new ApiError(0, 'REQUEST_TIMEOUT', '图片上传超时，请先检查素材列表，避免重复上传。'))
      xhr.onabort = () => reject(new ApiError(0, 'REQUEST_CANCELLED', '图片上传已取消。'))
      const data = new FormData()
      data.append('file', file, file.name)
      onProgress?.(0)
      xhr.send(data)
    })
  }
}
