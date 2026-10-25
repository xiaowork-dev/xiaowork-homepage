<script setup lang="ts">
import { featuredProjects } from '~/data/projects'

useSeoMeta({ title: 'XiaoWork — 个人品牌与项目展示' })
</script>

<template>
  <div>
    <section class="hero-surface" aria-labelledby="hero-title">
      <div class="flex flex-wrap gap-2">
        <TechTag>个人品牌</TechTag><TechTag>开发者作品集</TechTag>
      </div>
      <h1
        id="hero-title"
        class="mt-7 max-w-5xl text-4xl leading-tight font-semibold tracking-tight sm:text-6xl lg:text-7xl"
      >
        XiaoWork <span class="text-muted">— Developer</span>
      </h1>
      <p class="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">
        以代码构建想法，让作品连接更多可能。<br class="hidden sm:block" />
        这里是 XiaoWork 的个人品牌与开发项目展示空间。
      </p>
      <div class="mt-8 flex flex-wrap gap-3">
        <NuxtLink to="/projects" class="button-primary"
          >探索项目 <span aria-hidden="true">→</span></NuxtLink
        >
        <NuxtLink to="/about" class="button-secondary">关于 XiaoWork</NuxtLink>
      </div>
      <ul class="mt-9 flex flex-wrap gap-2" aria-label="本站技术栈">
        <li
          v-for="technology in ['Nuxt 4', 'Vue 3', 'TypeScript', 'Tailwind CSS', 'Docker']"
          :key="technology"
        >
          <TechTag>{{ technology }}</TechTag>
        </li>
      </ul>
    </section>
    <section class="mt-12 sm:mt-16" aria-labelledby="featured-title">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 id="featured-title" class="text-2xl font-semibold">精选项目</h2>
        <NuxtLink to="/projects" class="min-h-11 content-center text-sm text-muted hover:text-ink"
          >全部项目 →</NuxtLink
        >
      </div>
      <div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <ProjectCard v-for="project in featuredProjects" :key="project.id" :project="project" />
      </div>
    </section>
  </div>
</template>
