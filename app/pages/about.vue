<script setup lang="ts">
import { aboutProfile } from '~/data/about'
import { siteProfile } from '~/data/site'

useSiteSeo('about')
</script>

<template>
  <div>
    <section class="hero-surface" aria-labelledby="about-title">
      <p class="eyebrow">XIAOWORK / ABOUT</p>
      <h1 id="about-title" class="page-title">关于 XiaoWork</h1>
      <p class="page-introduction">{{ aboutProfile.brandIntroduction }}</p>
      <NuxtLink to="/projects" class="button-primary mt-7"
        >浏览作品 <AppIcon name="arrow-right"
      /></NuxtLink>
    </section>

    <div class="about-overview">
      <section class="content-panel" aria-labelledby="developer-title">
        <p class="eyebrow">THE DEVELOPER</p>
        <h2 id="developer-title">
          {{ siteProfile.name }} <span class="text-muted">/ 开发者</span>
        </h2>
        <p class="mt-2 text-sm text-subtle">{{ siteProfile.role }}</p>
        <div class="mt-6 space-y-3 leading-8 text-muted">
          <p v-for="line in siteProfile.introduction" :key="line">{{ line }}</p>
          <p v-for="line in aboutProfile.personalIntroduction" :key="line">{{ line }}</p>
        </div>
        <p v-if="!aboutProfile.personalIntroduction.length" class="content-note mt-6">
          更详细的个人介绍与开发经历，待资料确认后补充。
        </p>
      </section>
      <section class="content-panel" aria-labelledby="capabilities-title">
        <p class="eyebrow">TECHNOLOGY</p>
        <h2 id="capabilities-title">技术与开发方向</h2>
        <p class="mt-4 text-sm leading-7 text-muted">
          围绕网站、应用与工具开展实践。以下为本站已确认的技术展示方向，各项目的实际技术栈单独维护。
        </p>
        <dl class="capability-list">
          <div v-for="capability in aboutProfile.capabilities" :key="capability.title">
            <dt>{{ capability.title }}</dt>
            <dd>
              <ul class="flex flex-wrap gap-2" :aria-label="capability.title">
                <li v-for="technology in capability.technologies" :key="technology">
                  <TechTag>{{ technology }}</TechTag>
                </li>
              </ul>
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="mt-12" aria-labelledby="principles-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">HOW WE BUILD</p>
          <h2 id="principles-title">项目开发原则</h2>
        </div>
      </div>
      <div class="principle-grid">
        <article
          v-for="(principle, index) in aboutProfile.principles"
          :key="principle.title"
          class="content-panel"
        >
          <span class="principle-number" aria-hidden="true">0{{ index + 1 }}</span>
          <h3 class="mt-5 text-lg font-semibold">{{ principle.title }}</h3>
          <p class="mt-3 text-sm leading-7 text-muted">{{ principle.description }}</p>
        </article>
      </div>
    </section>

    <section class="content-panel mt-12" aria-labelledby="contact-title">
      <p class="eyebrow">STAY CONNECTED</p>
      <h2 id="contact-title">公开入口</h2>
      <ul v-if="aboutProfile.contacts.length" class="contact-list">
        <li v-for="contact in aboutProfile.contacts" :key="contact.url">
          <div>
            <h3>{{ contact.label }}</h3>
            <p>{{ contact.description }}</p>
          </div>
          <a
            :href="contact.url"
            target="_blank"
            rel="noopener noreferrer"
            class="button-secondary"
            :aria-label="`${contact.label}（新窗口）`"
            >前往 <AppIcon name="arrow-up-right"
          /></a>
        </li>
      </ul>
      <a v-if="aboutProfile.resume" :href="aboutProfile.resume.url" class="text-link mt-5"
        >{{ aboutProfile.resume.label }} <AppIcon name="arrow-up-right"
      /></a>
      <p class="content-note mt-6">其他公开联系方式与简历入口，待本人确认后开放。</p>
    </section>
  </div>
</template>
