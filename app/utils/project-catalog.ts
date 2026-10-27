import type { Project, ProjectCategory } from '../types/project'

export type CategoryFilter = 'all' | ProjectCategory
export type ProjectSort = 'recommended' | 'name-asc' | 'name-desc' | 'featured'

export interface CatalogFilters {
  category: CategoryFilter
  search: string
  sort: ProjectSort
}

// Query strings are public input. Ignore unknown values and bound search length.
export function parseCatalogQuery(
  query: Record<string, unknown>,
  categories = ['website', 'application', 'open-source'],
): CatalogFilters {
  return {
    category:
      typeof query.category === 'string' && categories.includes(query.category)
        ? (query.category as ProjectCategory)
        : 'all',
    search: typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '',
    sort:
      typeof query.sort === 'string' && ['name-asc', 'name-desc', 'featured'].includes(query.sort)
        ? (query.sort as ProjectSort)
        : 'recommended',
  }
}

export function filterProjects(projects: Project[], filters: CatalogFilters): Project[] {
  const terms = filters.search.toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean)
  const result = projects.filter((project) => {
    const text = [project.name, project.summary, ...project.techStack]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
    return (
      (filters.category === 'all' || project.category === filters.category) &&
      terms.every((term) => text.includes(term))
    )
  })
  return result.sort((a, b) => {
    if (filters.sort === 'name-asc' || filters.sort === 'name-desc') {
      const comparison = a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      return (filters.sort === 'name-desc' ? -comparison : comparison) || a.order - b.order
    }
    if (filters.sort === 'featured' && a.featured !== b.featured) {
      return Number(b.featured) - Number(a.featured)
    }
    return a.order - b.order || a.id.localeCompare(b.id)
  })
}
