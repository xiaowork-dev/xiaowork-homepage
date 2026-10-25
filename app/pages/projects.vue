<script setup lang="ts">
import { categoryLabels, sortedProjects } from '~/data/projects'
import type { ProjectCategory } from '~/types/project'

useSiteSeo('projects')

type CategoryFilter = 'all' | ProjectCategory
const selectedCategory = ref<CategoryFilter>('all')
const filterGroup = useTemplateRef<HTMLDivElement>('filterGroup')
async function showAllProjects() {
  selectedCategory.value = 'all'
  await nextTick()
  filterGroup.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
const categories = computed(() => [
  { id: 'all' as const, label: '全部项目', count: sortedProjects.length },
  ...Object.entries(categoryLabels).map(([id, label]) => ({
    id: id as ProjectCategory,
    label,
    count: sortedProjects.filter((project) => project.category === id).length,
  })),
])
const filteredProjects = computed(() =>
  sortedProjects.filter(
    (project) => selectedCategory.value === 'all' || project.category === selectedCategory.value,
  ),
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
      <fieldset class="min-w-0">
        <legend class="sr-only">按项目分类筛选</legend>
        <div ref="filterGroup" class="category-filters">
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            class="category-filter"
            :aria-pressed="selectedCategory === category.id"
            aria-controls="project-results"
            @click="selectedCategory = category.id"
          >
            {{ category.label }} <span>{{ category.count }}</span>
          </button>
        </div>
      </fieldset>
      <p role="status" aria-live="polite" aria-atomic="true" class="text-sm text-muted">
        显示 {{ filteredProjects.length }} 个项目
      </p>
    </div>
    <div v-if="filteredProjects.length" id="project-results" class="project-grid">
      <ProjectCard
        v-for="project in filteredProjects"
        :key="project.id"
        :project="project"
        :heading-level="2"
      />
    </div>
    <div v-else id="project-results" class="empty-state">
      <AppIcon name="layers" />
      <h2>这个分类还没有项目</h2>
      <p>后续作品会陆续整理到这里，先看看其他项目吧。</p>
      <button type="button" class="button-secondary mt-6" @click="showAllProjects">
        查看全部项目 <AppIcon name="arrow-right" />
      </button>
    </div>
  </section>
</template>
