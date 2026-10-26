<script setup lang="ts">
import { categoryLabels, sortedProjects } from '~/data/projects'
import type { ProjectCategory } from '~/types/project'
import { filterProjects, parseCatalogQuery } from '~/utils/project-catalog'
import type { CatalogFilters } from '~/utils/project-catalog'

useSiteSeo('projects')

const route = useRoute()
const router = useRouter()
// A static HTML file is shared by every query URL. Restore query state after
// hydration so direct filtered links match the prerendered DOM on first render.
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
})
const filters = computed(() => parseCatalogQuery(hydrated.value ? route.query : {}))
const searchDraft = ref(filters.value.search)
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
watch(
  () => filters.value.search,
  (value) => {
    searchDraft.value = value
  },
)

function updateFilters(change: Partial<CatalogFilters>) {
  const next = { ...filters.value, ...change }
  return router.push({
    path: '/projects',
    query: {
      ...(next.category !== 'all' ? { category: next.category } : {}),
      ...(next.search.trim() ? { q: next.search.trim().slice(0, 100) } : {}),
      ...(next.sort !== 'recommended' ? { sort: next.sort } : {}),
    },
  })
}
async function resetFilters() {
  searchDraft.value = ''
  await updateFilters({ category: 'all', search: '', sort: 'recommended' })
  await nextTick()
  searchInput.value?.focus()
}
const categories = computed(() => [
  { id: 'all' as const, label: '全部项目', count: sortedProjects.length },
  ...Object.entries(categoryLabels).map(([id, label]) => ({
    id: id as ProjectCategory,
    label,
    count: sortedProjects.filter((project) => project.category === id).length,
  })),
])
const filteredProjects = computed(() => filterProjects(sortedProjects, filters.value))
const hasFilters = computed(
  () =>
    filters.value.category !== 'all' ||
    !!filters.value.search ||
    filters.value.sort !== 'recommended',
)
</script>

<template>
  <section aria-labelledby="projects-title">
    <div class="hero-surface">
      <p class="eyebrow">XIAOWORK / PROJECTS</p>
      <h1 id="projects-title" class="page-title">项目与作品</h1>
      <p class="page-introduction">从网站到应用，把想法写成作品，也把每一次探索留在这里。</p>
      <p class="content-note mt-6">
        项目资料正在整理。封面、技术栈、状态与公开入口将在确认后补充。
      </p>
    </div>
    <div class="catalog-toolbar">
      <form
        class="catalog-search"
        role="search"
        aria-label="搜索项目"
        @submit.prevent="updateFilters({ search: searchDraft })"
      >
        <label for="project-search" class="sr-only">项目名称、简介或技术栈</label>
        <input
          id="project-search"
          ref="searchInput"
          v-model="searchDraft"
          class="catalog-input"
          type="search"
          maxlength="100"
          placeholder="搜索项目名称、简介或技术栈"
          aria-controls="project-results"
        />
        <button type="submit" class="button-secondary">搜索</button>
      </form>
      <label class="catalog-sort" for="project-sort"
        >排序
        <select
          id="project-sort"
          class="catalog-input"
          :value="filters.sort"
          @change="
            updateFilters({
              sort: ($event.target as HTMLSelectElement).value as CatalogFilters['sort'],
            })
          "
        >
          <option value="recommended">推荐顺序</option>
          <option value="featured">精选优先</option>
          <option value="name-asc">名称 A → Z</option>
          <option value="name-desc">名称 Z → A</option>
        </select>
      </label>
    </div>
    <div class="catalog-toolbar mt-0">
      <fieldset class="min-w-0">
        <legend class="sr-only">按项目分类筛选</legend>
        <div class="category-filters">
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            class="category-filter"
            :aria-pressed="filters.category === category.id"
            aria-controls="project-results"
            @click="updateFilters({ category: category.id })"
          >
            {{ category.label }} <span>{{ category.count }}</span>
          </button>
        </div>
      </fieldset>
      <p role="status" aria-live="polite" aria-atomic="true" class="text-sm text-muted">
        显示 {{ filteredProjects.length }} / {{ sortedProjects.length }} 个项目
        <span v-if="filters.search"> · 搜索“{{ filters.search }}”</span>
      </p>
      <button v-if="hasFilters" type="button" class="text-link" @click="resetFilters">
        重置筛选
      </button>
    </div>
    <div v-if="filteredProjects.length" id="project-results" class="project-grid">
      <ProjectCard
        v-for="(project, index) in filteredProjects"
        :key="project.id"
        :project="project"
        :heading-level="2"
        :eager="index === 0"
      />
    </div>
    <div v-else id="project-results" class="empty-state">
      <AppIcon name="layers" />
      <h2>{{ filters.search ? '没有找到匹配的项目' : '这个分类还没有项目' }}</h2>
      <p>试试其他关键词或分类，也可以清除筛选查看全部作品。</p>
      <button v-if="hasFilters" type="button" class="button-secondary mt-6" @click="resetFilters">
        查看全部项目 <AppIcon name="arrow-right" />
      </button>
    </div>
  </section>
</template>
