<script setup lang="ts">
import type { Project } from '~/types/project'
import { categoryLabels, statusLabels } from '~/data/projects'
import { assetURL } from '#shared/content'

const props = withDefaults(
  defineProps<{ project: Project; headingLevel?: 2 | 3; eager?: boolean }>(),
  {
    headingLevel: 3,
    eager: false,
  },
)
const coverFailure = ref(0)
const coverImage = useTemplateRef<HTMLImageElement>('coverImage')
function handleCoverError() {
  coverFailure.value = Math.min(coverFailure.value + 1, 2)
}
onMounted(() => {
  // Eager images can fail before hydration attaches their error listener.
  if (coverImage.value?.complete && !coverImage.value.naturalWidth) handleCoverError()
})
watch(
  () => props.project.cover,
  () => {
    coverFailure.value = 0
  },
)
</script>

<template>
  <article class="project-card">
    <div class="project-cover">
      <picture v-if="coverFailure < 2">
        <source
          v-if="!coverFailure && project.coverSources?.avif"
          :srcset="project.coverSources.avif"
          type="image/avif"
        />
        <source
          v-if="!coverFailure && project.coverSources?.webp"
          :srcset="project.coverSources.webp"
          type="image/webp"
        />
        <img
          ref="coverImage"
          :src="coverFailure ? assetURL('/images/projects/placeholder.svg') : project.cover"
          :alt="coverFailure ? `${project.name} 封面暂不可用，显示占位图` : project.coverAlt"
          width="960"
          height="600"
          :loading="eager ? 'eager' : 'lazy'"
          :fetchpriority="eager ? 'high' : 'auto'"
          decoding="async"
          class="aspect-[8/5] w-full object-cover"
          @error="handleCoverError"
        />
      </picture>
      <div v-else class="cover-unavailable" role="img" :aria-label="`${project.name} 封面暂不可用`">
        <AppIcon name="layers" />
        <span>封面暂不可用</span>
      </div>
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
          :aria-label="`查看项目：${project.name} 官网（新窗口）`"
          >查看项目 <AppIcon name="arrow-up-right"
        /></a>
        <a
          v-if="project.repositoryUrl"
          :href="project.repositoryUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-link"
          :aria-label="`查看源码：${project.name} GitHub（新窗口）`"
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
