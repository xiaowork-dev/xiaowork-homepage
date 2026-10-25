<script setup lang="ts">
import type { Project } from '~/types/project'
import { categoryLabels, statusLabels } from '~/data/projects'

const props = withDefaults(defineProps<{ project: Project; headingLevel?: 2 | 3 }>(), {
  headingLevel: 3,
})
const coverFailed = ref(false)
watch(
  () => props.project.cover,
  () => {
    coverFailed.value = false
  },
)
</script>

<template>
  <article class="project-card">
    <div class="project-cover">
      <img
        :src="coverFailed ? '/images/projects/placeholder.svg' : project.cover"
        :alt="coverFailed ? `${project.name} 封面暂不可用，显示占位图` : project.coverAlt"
        width="960"
        height="600"
        loading="lazy"
        decoding="async"
        class="aspect-[8/5] w-full object-cover"
        @error="coverFailed = true"
      />
    </div>
    <div class="project-title-row">
      <component :is="`h${headingLevel}`">{{ project.name }}</component>
      <span class="project-status"
        ><span aria-hidden="true" />{{ statusLabels[project.status] }}</span
      >
    </div>
    <p class="project-summary">{{ project.summary }}</p>
    <ul v-if="project.techStack.length" class="project-technologies" aria-label="技术栈">
      <li v-for="technology in project.techStack" :key="technology">
        <TechTag>{{ technology }}</TechTag>
      </li>
    </ul>
    <p v-else class="project-technologies"><TechTag>技术栈待确认</TechTag></p>
    <div class="project-footer">
      <span>{{ categoryLabels[project.category] }}</span>
      <div class="project-links">
        <a
          v-if="project.demoUrl"
          :href="project.demoUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-link"
          :aria-label="`访问 ${project.name} 官网（新窗口）`"
          >查看项目 <AppIcon name="arrow-up-right"
        /></a>
        <a
          v-if="project.repositoryUrl"
          :href="project.repositoryUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-link"
          :aria-label="`查看 ${project.name} GitHub 源码（新窗口）`"
          >查看源码 <AppIcon name="arrow-up-right"
        /></a>
        <span
          v-if="!project.demoUrl && !project.repositoryUrl"
          class="unavailable-link"
          aria-disabled="true"
          >入口待确认 <AppIcon name="arrow-up-right"
        /></span>
      </div>
    </div>
  </article>
</template>
