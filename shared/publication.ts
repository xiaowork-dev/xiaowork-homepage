/** Data-only public contract. Never import the private workspace or media DTO here. */
export const publicOrigin = 'https://xiaoworks.com'
export const builtinAssets: Record<string, string> = {
  'builtin-cover-blog': 'images/projects/blog/placeholder.svg',
  'builtin-cover-nav': 'images/projects/nav/placeholder.svg',
  'builtin-cover-erp': 'images/projects/erp/placeholder.svg',
  'builtin-social-share': 'images/social/xiaowork-share.png',
  'builtin-brand-icon': 'favicon.svg',
}

export interface PublicReference {
  kind: 'builtin' | 'media'
  id: string
}
export interface PublicMedia {
  id: string
  sha256: string
  mediaType: string
  byteSize: number
  width: number
  height: number
  alt: string
  path: string
}
export interface PublicPageSeo {
  title: string
  description: string
  shareAssetId: string | null
}
export interface PublicSnapshot {
  schemaVersion: 1
  snapshotId: string
  workspaceRevision: string
  createdAt: string
  siteProfile: {
    name: string
    role: string
    introduction: string[]
    directions: string[]
    technologies: string[]
    githubUrl: string | null
    avatarAssetId: string | null
    brandAssetId: string | null
  }
  aboutProfile: {
    brandIntroduction: string
    personalIntroduction: string[]
    capabilities: { title: string; technologies: string[] }[]
    principles: { title: string; description: string }[]
    contacts: { label: string; description: string; url: string }[]
    resume?: { label: string; url: string } | null
  }
  siteSettings: {
    siteTitle: string
    siteDescription: string
    defaultSeoDescription: string
    homeIntroduction: string[]
    footerText: string
    defaultShareAssetId: string | null
    socialLinks: { label: string; url: string }[]
    pages: { home: PublicPageSeo; projects: PublicPageSeo; about: PublicPageSeo }
  }
  visibleProjects: {
    id: string
    order: number
    slug: string
    name: string
    summary: string
    description: string
    category: string
    techStack: string[]
    status: 'unconfirmed' | 'planning' | 'in-development' | 'live' | 'maintained'
    featured: boolean
    visible: true
    isPlaceholder: boolean
    cover: PublicReference
    coverAlt: string
    coverKind: 'placeholder' | 'screenshot'
    demoUrl: string | null
    repositoryUrl: string | null
  }[]
  categories: { slug: string; name: string; order: number }[]
  mediaManifest: PublicMedia[]
  legacyAssetAllowlist: string[]
}
export interface PublicationContext {
  releaseId: string
  snapshotSha256: string
  baseURL: string
  assetPrefix: string
  preview: boolean
}

function fail(): never {
  throw new Error('Invalid public content snapshot')
}
function object(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const record = value as Record<string, unknown>
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key))
  )
    return fail()
  return record
}
function text(value: unknown, max = 20000, min = 0): asserts value is string {
  if (
    typeof value !== 'string' ||
    [...value].length > max ||
    [...value].length < min ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127
    }) ||
    /<\s*\/?\s*[a-z!][^>]*>/i.test(value)
  )
    fail()
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail()
  return value
}
function strings(value: unknown, max: number, size: number): string[] {
  const values = array(value, max)
  values.forEach((item) => text(item, size, 1))
  return values as string[]
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail()
}
function url(value: unknown, email = false): void {
  text(value, 2048, 1)
  if (email && /^mailto:[^\s@?#]+@[^\s@?#]+$/.test(value)) return
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return fail()
  }
  const host = parsed.hostname.toLowerCase()
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    !host.includes('.') ||
    /^(?:\d+\.){3}\d+$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
    /\/(?:admin|administrator|wp-admin)(?:\/|$)/i.test(parsed.pathname)
  )
    fail()
}
function optionalUrl(value: unknown): void {
  if (value !== null) url(value)
}
function slug(value: unknown): void {
  text(value, 64, 1)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) fail()
}
function assetId(value: unknown, available: Set<string>): void {
  if (value === null) return
  text(value, 80, 1)
  if (!available.has(value)) fail()
}

/** Reject unknown/private fields before data can enter any HTML or client bundle. */
export function parsePublicSnapshot(value: unknown): PublicSnapshot {
  const root = object(value, [
    'schemaVersion',
    'snapshotId',
    'workspaceRevision',
    'createdAt',
    'siteProfile',
    'aboutProfile',
    'siteSettings',
    'visibleProjects',
    'categories',
    'mediaManifest',
    'legacyAssetAllowlist',
  ])
  if (
    root.schemaVersion !== 1 ||
    typeof root.snapshotId !== 'string' ||
    !/^snap_[0-9a-f]{32}$/.test(root.snapshotId) ||
    typeof root.workspaceRevision !== 'string' ||
    !/^ws-\d+$/.test(root.workspaceRevision) ||
    typeof root.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(root.createdAt))
  )
    fail()
  const available = new Set<string>()
  for (const id of strings(root.legacyAssetAllowlist, 5, 80)) {
    if (!Object.hasOwn(builtinAssets, id) || available.has(id)) fail()
    available.add(id)
  }
  for (const value of array(root.mediaManifest, 1000)) {
    const media = object(value, [
      'id',
      'sha256',
      'mediaType',
      'byteSize',
      'width',
      'height',
      'alt',
      'path',
    ])
    if (
      typeof media.id !== 'string' ||
      !/^med_[0-9a-f]{32}$/.test(media.id) ||
      available.has(media.id) ||
      typeof media.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(media.sha256)
    )
      fail()
    const extension = (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/avif': 'avif',
      } as Record<string, string>
    )[String(media.mediaType)]
    if (!extension || media.path !== `media/${media.sha256}.${extension}`) fail()
    integer(media.byteSize, 1, 25 * 1024 * 1024)
    integer(media.width, 1, 8192)
    integer(media.height, 1, 8192)
    if (media.width * media.height > 25000000) fail()
    text(media.alt, 500)
    available.add(media.id)
  }
  const site = object(root.siteProfile, [
    'name',
    'role',
    'introduction',
    'directions',
    'technologies',
    'githubUrl',
    'avatarAssetId',
    'brandAssetId',
  ])
  text(site.name, 80, 1)
  text(site.role, 120, 1)
  strings(site.introduction, 8, 500)
  strings(site.directions, 10, 40)
  strings(site.technologies, 30, 40)
  optionalUrl(site.githubUrl)
  assetId(site.avatarAssetId, available)
  assetId(site.brandAssetId, available)
  const about = object(
    root.aboutProfile,
    ['brandIntroduction', 'personalIntroduction', 'capabilities', 'principles', 'contacts'],
    ['resume'],
  )
  text(about.brandIntroduction, 1000, 1)
  strings(about.personalIntroduction, 12, 1000)
  for (const value of array(about.capabilities, 10)) {
    const item = object(value, ['title', 'technologies'])
    text(item.title, 80, 1)
    strings(item.technologies, 30, 40)
  }
  for (const value of array(about.principles, 10)) {
    const item = object(value, ['title', 'description'])
    text(item.title, 80, 1)
    text(item.description, 500, 1)
  }
  for (const value of array(about.contacts, 10)) {
    const item = object(value, ['label', 'description', 'url'])
    text(item.label, 80, 1)
    text(item.description, 300)
    url(item.url, true)
  }
  if (about.resume !== undefined && about.resume !== null) {
    const item = object(about.resume, ['label', 'url'])
    text(item.label, 80, 1)
    url(item.url)
  }
  const settings = object(root.siteSettings, [
    'siteTitle',
    'siteDescription',
    'defaultSeoDescription',
    'homeIntroduction',
    'footerText',
    'defaultShareAssetId',
    'socialLinks',
    'pages',
  ])
  text(settings.siteTitle, 100, 1)
  text(settings.siteDescription, 300, 1)
  text(settings.defaultSeoDescription, 300, 1)
  text(settings.footerText, 300)
  strings(settings.homeIntroduction, 8, 500)
  assetId(settings.defaultShareAssetId, available)
  for (const value of array(settings.socialLinks, 10)) {
    const item = object(value, ['label', 'url'])
    text(item.label, 80, 1)
    url(item.url)
  }
  const pages = object(settings.pages, ['home', 'projects', 'about'])
  for (const page of Object.values(pages)) {
    const item = object(page, ['title', 'description', 'shareAssetId'])
    text(item.title, 100)
    text(item.description, 300)
    assetId(item.shareAssetId, available)
  }
  const categories = new Set<string>()
  for (const value of array(root.categories, 1000)) {
    const category = object(value, ['slug', 'name', 'order'])
    slug(category.slug)
    text(category.name, 80, 1)
    integer(category.order)
    if (categories.has(String(category.slug))) fail()
    categories.add(String(category.slug))
  }
  const ids = new Set<string>(),
    slugs = new Set<string>()
  for (const value of array(root.visibleProjects, 1000)) {
    const project = object(value, [
      'id',
      'order',
      'slug',
      'name',
      'summary',
      'description',
      'category',
      'techStack',
      'status',
      'featured',
      'visible',
      'isPlaceholder',
      'cover',
      'coverAlt',
      'coverKind',
      'demoUrl',
      'repositoryUrl',
    ])
    text(project.id, 80, 1)
    integer(project.order)
    slug(project.slug)
    text(project.name, 80, 1)
    text(project.summary, 500, 1)
    text(project.description)
    if (
      ids.has(project.id) ||
      slugs.has(String(project.slug)) ||
      !categories.has(String(project.category)) ||
      project.visible !== true ||
      typeof project.featured !== 'boolean' ||
      typeof project.isPlaceholder !== 'boolean' ||
      !['unconfirmed', 'planning', 'in-development', 'live', 'maintained'].includes(
        String(project.status),
      ) ||
      !['placeholder', 'screenshot'].includes(String(project.coverKind))
    )
      fail()
    strings(project.techStack, 20, 40)
    text(project.coverAlt, 200, 1)
    optionalUrl(project.demoUrl)
    optionalUrl(project.repositoryUrl)
    const cover = object(project.cover, ['kind', 'id'])
    assetId(cover.id, available)
    if (
      (cover.kind !== 'builtin' && cover.kind !== 'media') ||
      cover.id === null ||
      (cover.kind === 'builtin') !== Object.hasOwn(builtinAssets, String(cover.id))
    )
      fail()
    ids.add(project.id)
    slugs.add(String(project.slug))
  }
  return value as PublicSnapshot
}

export function publicationContext(
  releaseId: string,
  previewId: string,
  snapshotSha256: string,
): PublicationContext {
  const preview = /^pre_[0-9a-f]{32}$/.test(releaseId)
  if (
    (!preview && !/^rel_[0-9a-f]{32}$/.test(releaseId)) ||
    (preview ? previewId !== releaseId : !!previewId) ||
    !/^[0-9a-f]{64}$/.test(snapshotSha256)
  )
    fail()
  const baseURL = preview ? `/api/admin/v1/previews/${releaseId}/` : '/'
  return {
    releaseId,
    snapshotSha256,
    baseURL,
    assetPrefix: preview ? `${baseURL}assets/` : `/_releases/${releaseId}/assets/`,
    preview,
  }
}

export function publicAsset(path: string, context: PublicationContext | null): string {
  if (
    !/^(?:favicon\.svg|theme-init\.js|images\/[a-z0-9/-]+\.(?:svg|png|webp|avif|jpg)|media\/[0-9a-f]{64}\.(?:png|jpg|webp|avif))$/.test(
      path,
    )
  )
    fail()
  return context ? context.assetPrefix + path : '/' + path
}

export function resolvePublicAsset(
  id: string,
  snapshot: PublicSnapshot,
  context: PublicationContext,
): string {
  const builtin =
    Object.hasOwn(builtinAssets, id) && snapshot.legacyAssetAllowlist.includes(id)
      ? builtinAssets[id]
      : undefined
  const media = snapshot.mediaManifest.find((item) => item.id === id)
  if (!builtin && !media) return fail()
  return publicAsset(builtin ?? media!.path, context)
}
