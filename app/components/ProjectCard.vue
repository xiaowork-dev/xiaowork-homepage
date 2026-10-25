<script setup lang="ts">
import type { Project } from '~/types/project'
import { categoryLabels, statusLabels } from '~/data/projects'

defineProps<{ project: Project }>()
</script>

<template>
  <article
    class="group flex min-w-0 flex-col rounded-3xl border border-line bg-surface p-5 transition-transform duration-200 hover:-translate-y-1 sm:p-6"
  >
    <div class="overflow-hidden rounded-2xl bg-page">
      <img
        :src="project.cover"
        :alt="project.coverAlt"
        width="960"
        height="600"
        loading="lazy"
        decoding="async"
        class="aspect-[8/5] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />
    </div>
    <div class="mt-5 flex flex-wrap items-center gap-2 text-xs text-subtle">
      <span>{{ categoryLabels[project.category] }}</span>
      <span aria-hidden="true">·</span>
      <span>{{ project.isPlaceholder ? '示例资料 · 待确认' : statusLabels[project.status] }}</span>
    </div>
    <h3 class="mt-3 text-xl font-semibold">{{ project.name }}</h3>
    <p class="mt-2 flex-1 text-sm leading-7 text-muted">{{ project.summary }}</p>
    <ul v-if="project.techStack.length" class="mt-5 flex flex-wrap gap-2" aria-label="技术栈">
      <li v-for="technology in project.techStack" :key="technology">
        <TechTag>{{ technology }}</TechTag>
      </li>
    </ul>
    <div v-if="project.demoUrl || project.repositoryUrl" class="mt-5 flex flex-wrap gap-4 text-sm">
      <a
        v-if="project.demoUrl"
        :href="project.demoUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="min-h-11 content-center"
        >查看网站 ↗</a
      >
      <a
        v-if="project.repositoryUrl"
        :href="project.repositoryUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="min-h-11 content-center"
        >查看源码 ↗</a
      >
    </div>
  </article>
</template>
