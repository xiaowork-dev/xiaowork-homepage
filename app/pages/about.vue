<script setup lang="ts">
useSeoMeta({ title: '关于 — XiaoWork', description: '了解 XiaoWork 个人品牌与开发实践。' })
</script>

<template>
  <section class="hero-surface" aria-labelledby="about-title">
    <p class="text-sm text-subtle">XiaoWork / About</p>
    <h1 id="about-title" class="mt-4 text-4xl font-semibold sm:text-5xl">关于 XiaoWork</h1>
    <p class="mt-6 max-w-2xl leading-8 text-muted">
      XiaoWork 是用于展示个人技术能力、网站与软件开发项目的品牌空间。
    </p>
    <p class="mt-4 max-w-2xl leading-8 text-muted">
      更详细的个人介绍、开发历程、联系方式与简历将在资料确认后补充。
    </p>
    <NuxtLink to="/projects" class="button-primary mt-8">浏览项目 →</NuxtLink>
  </section>
</template>
