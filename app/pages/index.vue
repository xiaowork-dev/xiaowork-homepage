<script setup lang="ts">
import { featuredProjects } from '~/data/projects'
import { siteProfile } from '~/data/site'

const highlights = [
  { icon: 'code', title: '全栈开发', detail: '从界面体验，到服务实现' },
  { icon: 'layers', title: '项目与实践', detail: '网站、应用与实用工具' },
  { icon: 'spark', title: '持续创造', detail: '把每一个想法，写成作品' },
] as const

useSeoMeta({ title: 'XiaoWork — 个人品牌与项目展示' })
</script>

<template>
  <div>
    <section class="hero-surface" aria-labelledby="hero-title">
      <div class="hero-directions" aria-label="技术方向">
        <span v-for="direction in siteProfile.directions" :key="direction">{{ direction }}</span>
      </div>
      <h1 id="hero-title" class="hero-title">
        {{ siteProfile.name }} <span>— {{ siteProfile.role }}</span>
      </h1>
      <div class="hero-introduction">
        <p v-for="line in siteProfile.introduction" :key="line">{{ line }}</p>
      </div>
      <div class="hero-actions">
        <NuxtLink to="/projects" class="button-primary">
          探索项目 <AppIcon name="arrow-right" />
        </NuxtLink>
        <a
          v-if="siteProfile.githubUrl"
          :href="siteProfile.githubUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="button-secondary"
          aria-label="GitHub：查看本站源码（新窗口）"
        >
          <AppIcon name="github" /> GitHub <AppIcon name="arrow-up-right" />
        </a>
      </div>
      <ul class="hero-technologies" aria-label="技术栈与开发方向">
        <li v-for="technology in siteProfile.technologies" :key="technology">
          <TechTag>{{ technology }}</TechTag>
        </li>
      </ul>
      <ul class="hero-highlights" aria-label="创作与开发">
        <li v-for="highlight in highlights" :key="highlight.title">
          <AppIcon :name="highlight.icon" />
          <div>
            <p>{{ highlight.title }}</p>
            <span>{{ highlight.detail }}</span>
          </div>
        </li>
      </ul>
    </section>
    <section class="featured-section" aria-labelledby="featured-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">SELECTED WORK</p>
          <h2 id="featured-title">精选项目</h2>
        </div>
        <NuxtLink to="/projects" class="text-link"
          >全部项目 <AppIcon name="arrow-right"
        /></NuxtLink>
      </div>
      <div class="project-grid">
        <ProjectCard v-for="project in featuredProjects" :key="project.id" :project="project" />
      </div>
    </section>
  </div>
</template>
