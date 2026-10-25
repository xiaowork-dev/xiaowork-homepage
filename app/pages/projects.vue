<script setup lang="ts">
import { sortedProjects } from '~/data/projects'

useSeoMeta({ title: '项目 — XiaoWork', description: '浏览 XiaoWork 的网站、应用与工具项目。' })
</script>

<template>
  <section aria-labelledby="projects-title">
    <div class="hero-surface">
      <p class="text-sm text-subtle">XiaoWork / Projects</p>
      <h1 id="projects-title" class="mt-4 text-4xl font-semibold sm:text-5xl">项目与作品</h1>
      <p class="mt-5 max-w-2xl leading-8 text-muted">
        从网站到应用，记录 XiaoWork
        的开发实践。以下为待确认的示例资料，正式截图和公开入口将在内容阶段补充。
      </p>
    </div>
    <div class="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      <ProjectCard v-for="project in sortedProjects" :key="project.id" :project="project" />
    </div>
  </section>
</template>
