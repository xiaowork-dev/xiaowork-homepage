<script setup lang="ts">
import { siteProfile } from '~/data/site'
import { snapshot } from '#shared/content'
</script>

<template>
  <footer class="site-footer">
    <div
      class="site-container flex flex-wrap items-center justify-between gap-4 py-7 text-sm text-subtle"
    >
      <p>
        © {{ new Date().getFullYear() }} {{ siteProfile.name }}
        <span class="ml-3 hidden sm:inline">{{
          snapshot?.siteSettings.footerText ?? '用代码构建想法。'
        }}</span>
      </p>
      <div class="flex items-center gap-6">
        <a
          v-if="siteProfile.githubUrl"
          :href="siteProfile.githubUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-link"
          aria-label="GitHub：查看本站源码（新窗口）"
          >GitHub <AppIcon name="arrow-up-right"
        /></a>
        <NuxtLink to="/about" class="text-link"
          >关于 {{ siteProfile.name }} <AppIcon name="arrow-right"
        /></NuxtLink>
        <template v-if="snapshot">
          <a
            v-for="link in snapshot.siteSettings.socialLinks"
            :key="link.url"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link"
            >{{ link.label }} <AppIcon name="arrow-up-right"
          /></a>
        </template>
      </div>
    </div>
  </footer>
</template>
