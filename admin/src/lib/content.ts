import type { Project, ProjectInput } from './types'
import { ApiError } from './api.ts'

export const projectStatuses = [
  { value: 'unconfirmed', label: '待确认' },
  { value: 'planning', label: '规划中' },
  { value: 'in-development', label: '开发中' },
  { value: 'live', label: '已上线' },
  { value: 'maintained', label: '持续维护' },
] as const

export const builtinCovers = [
  {
    id: 'builtin-cover-blog',
    label: 'Blog 占位封面',
    path: '/images/projects/blog/placeholder.svg',
  },
  { id: 'builtin-cover-nav', label: 'Nav 占位封面', path: '/images/projects/nav/placeholder.svg' },
  { id: 'builtin-cover-erp', label: 'ERP 占位封面', path: '/images/projects/erp/placeholder.svg' },
] as const

export const builtinAssets = [
  ...builtinCovers,
  { id: 'builtin-brand-icon', label: '仓库内置品牌图标', path: '/favicon.svg' },
  {
    id: 'builtin-social-share',
    label: '仓库内置品牌分享图',
    path: '/images/social/xiaowork-share.png',
  },
] as const

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function projectInput(project?: Project, category = ''): ProjectInput {
  if (project) {
    const {
      slug,
      name,
      summary,
      description,
      category,
      techStack,
      status,
      featured,
      visible,
      isPlaceholder,
      cover,
      coverAlt,
      coverKind,
      demoUrl,
      repositoryUrl,
    } = project
    return clone({
      slug,
      name,
      summary,
      description,
      category,
      techStack,
      status,
      featured,
      visible,
      isPlaceholder,
      cover,
      coverAlt,
      coverKind,
      demoUrl,
      repositoryUrl,
    })
  }
  return {
    slug: '',
    name: '',
    summary: '',
    description: '',
    category,
    techStack: [],
    status: 'unconfirmed',
    featured: false,
    visible: false,
    isPlaceholder: true,
    cover: { kind: 'builtin', id: '' },
    coverAlt: '',
    coverKind: 'placeholder',
    demoUrl: null,
    repositoryUrl: null,
  }
}

export function statusLabel(value: string): string {
  return projectStatuses.find((status) => status.value === value)?.label ?? value
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 429 && error.retryAfter !== null) {
    return `${error.message} 请至少等待 ${error.retryAfter} 秒后再手动重试。`
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items
  const next = [...items]
  const item = next.splice(from, 1)[0]
  if (item === undefined) return items
  next.splice(to, 0, item)
  return next
}

export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

export async function validateImageFile(file: File): Promise<{ width: number; height: number }> {
  if (file.size === 0 || file.size > 10 * 1024 * 1024)
    throw new Error('请选择大于 0 且不超过 10 MiB 的图片。')
  const suffix = file.name.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }
  if (!suffix || types[suffix] !== file.type)
    throw new Error('仅支持扩展名与类型一致的 PNG、JPEG、WebP；不支持 SVG、GIF 或 AVIF 上传。')
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const format =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      ? 'image/png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        ? 'image/jpeg'
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
            String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
          ? 'image/webp'
          : ''
  if (format !== file.type) throw new Error('图片内容与声明格式不符，请重新导出原图。')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('浏览器无法解码此图片，请检查文件是否损坏。')
  }
  const dimensions = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > 8192 ||
    dimensions.height > 8192 ||
    dimensions.width * dimensions.height > 25_000_000
  ) {
    throw new Error('图片单边不得超过 8,192 px，总像素不得超过 2,500 万。')
  }
  return dimensions
}
