export type ProjectCategory = 'website' | 'application' | 'open-source'
export type ProjectStatus = 'planning' | 'in-development' | 'live' | 'maintained'

export interface Project {
  id: string
  slug: string
  name: string
  summary: string
  cover: string
  coverAlt: string
  category: ProjectCategory
  techStack: string[]
  status: ProjectStatus
  featured: boolean
  order: number
  demoUrl?: `https://${string}`
  repositoryUrl?: `https://${string}`
  isPlaceholder?: boolean
}
