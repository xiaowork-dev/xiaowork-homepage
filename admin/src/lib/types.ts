export type Revision = `ws-${number}`
export type ProjectStatus = 'unconfirmed' | 'planning' | 'in-development' | 'live' | 'maintained'

export interface Session {
  administrator: { id: number; username: string }
  csrfToken: string
  expiresAt: string
  idleExpiresAt: string
  reauthUntil: string
}

export interface AssetReference {
  kind: 'builtin' | 'media'
  id: string
}
export interface ProjectInput {
  slug: string
  name: string
  summary: string
  description: string
  category: string
  techStack: string[]
  status: ProjectStatus
  featured: boolean
  visible: boolean
  isPlaceholder: boolean
  cover: AssetReference
  coverAlt: string
  coverKind: 'placeholder' | 'screenshot'
  demoUrl: string | null
  repositoryUrl: string | null
}
export interface Project extends ProjectInput {
  id: string
  order: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
export interface Category {
  id: string
  slug: string
  name: string
  order: number
  projectCount: number
}
export interface Profile {
  site: {
    name: string
    role: string
    introduction: string[]
    directions: string[]
    technologies: string[]
    githubUrl: string | null
    avatarAssetId: string | null
    brandAssetId: string | null
  }
  about: {
    brandIntroduction: string
    personalIntroduction: string[]
    capabilities: { title: string; technologies: string[] }[]
    principles: { title: string; description: string }[]
    contacts: { label: string; description: string; url: string }[]
    resume?: { label: string; url: string } | null
  }
}
export interface PageSEO {
  title: string
  description: string
  shareAssetId: string | null
}
export interface Settings {
  siteTitle: string
  siteDescription: string
  defaultSeoDescription: string
  homeIntroduction: string[]
  footerText: string
  defaultShareAssetId: string | null
  socialLinks: { label: string; url: string }[]
  pages: { home: PageSEO; projects: PageSEO; about: PageSEO }
}
export interface Workspace {
  revision: string
  projects: Project[]
  categories: Category[]
  profile: Profile | null
  settings: Settings | null
  origin: 'https://xiaoworks.com'
  initialized: boolean
  validation: { code: string; message: string } | null
}
export interface Dashboard {
  revision: string
  activeReleaseId: string | null
  activeVerified: boolean
  publicationState: 'not-integrated' | 'local-only' | 'verified' | 'recovery-required'
  workerAvailable: boolean
  counts: {
    projects: number
    visibleProjects: number
    categories: number
    featuredProjects: number
    publishedProjects: number | null
  }
  draftDiff: {
    available: boolean
    changed: number | null
    added: number | null
    modified: number | null
    removed: number | null
  }
  recentEvents: {
    action: string
    resourceType: string
    resourceId: string | null
    outcome: 'success' | 'failure' | 'denied'
    createdAt: string
  }[]
}
export interface Media {
  id: string
  sha256: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'
  byteSize: number
  width: number
  height: number
  alt: string
  displayName: string
  publicUseConfirmed: boolean
  publicConfirmationNote: string
  publicConfirmedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  contentUrl: string
  references: { projects: number; documents: number; snapshots: number }
}
export interface ProjectList {
  projects: Project[]
  revision: string
  total: number
  nextCursor: string | null
}
export interface CategoryList {
  categories: Category[]
  revision: string
  total: number
  nextCursor: string | null
}
export interface MediaList {
  items: Media[]
  nextCursor: string
}
export interface ProjectResult {
  project: Project
  revision: string
}
export interface CategoryResult {
  category: Category
  revision: string
}
export interface MediaResult {
  media: Media
  revision: string
}
export interface ProfileResult {
  profile: Profile | null
  initialized?: boolean
  revision: string
}
export interface SettingsResult {
  settings: Settings | null
  initialized?: boolean
  origin?: string
  revision: string
}
export type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type PublicationKind = 'publish' | 'preview' | 'rollback'
export interface PublicationJob {
  id: string
  kind: PublicationKind
  status: string
  phase: string | null
  snapshotId: string
  workspaceRevision: string
  releaseId: string
  targetReleaseId: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  error: { code: string; message: string } | null
  activeVerified: boolean
}
export interface PublishedRelease {
  id: string
  snapshotId: string
  kind: 'publication' | 'preview'
  workspaceRevision: string
  createdAt: string
  expiresAt: string | null
  active: boolean
  verified: boolean
  previewUrl: string | null
}
export interface PublishingStatus {
  enabled: boolean
  localOnly: boolean
  workerAvailable: boolean
  activeReleaseId: string | null
  activeVerified: boolean
  blockingJob: PublicationJob | null
  reason: string
  storage?: {
    state: 'ok' | 'warning' | 'critical'
    areas: {
      name: string
      state: string
      freeBytes: number
      totalBytes: number
      usedBytes: number
      files: number
      usageComplete: boolean
    }[]
    minimumFreeBytes: number
    warningFreeBytes: number
    usageSampledAt: string
    historicalResourcesRetained: boolean
  }
  review?: {
    revision: string
    available: boolean
    added: { id: string; name: string }[]
    modified: { id: string; name: string }[]
    hidden: { id: string; name: string }[]
    archived: { id: string; name: string }[]
    profileChanged: boolean
    settingsChanged: boolean
    categoriesChanged: boolean
    mediaChanged: boolean
  }
}
