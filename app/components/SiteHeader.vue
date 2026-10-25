<script setup lang="ts">
const menuOpen = ref(false)
const route = useRoute()
const links = [
  { to: '/', label: '首页' },
  { to: '/projects', label: '项目' },
  { to: '/about', label: '关于' },
]
watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)
</script>

<template>
  <header
    class="site-container relative flex min-h-24 flex-wrap items-center justify-between gap-4 py-5"
  >
    <NuxtLink to="/" class="text-xl font-semibold tracking-tight" aria-label="XiaoWork 首页">
      XiaoWork<span class="text-accent">.</span>
    </NuxtLink>
    <div class="flex items-center gap-3 sm:gap-6">
      <nav aria-label="主导航" class="hidden items-center gap-7 sm:flex">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="py-3 text-sm text-muted transition-colors hover:text-ink"
          active-class="!text-ink"
          :exact="link.to === '/'"
          >{{ link.label }}</NuxtLink
        >
      </nav>
      <ThemeToggle />
      <button
        type="button"
        class="min-h-11 rounded-xl border border-line px-3 text-sm sm:hidden"
        :aria-expanded="menuOpen"
        aria-controls="mobile-navigation"
        @click="menuOpen = !menuOpen"
        @keydown.esc="menuOpen = false"
      >
        {{ menuOpen ? '关闭' : '菜单' }}
      </button>
    </div>
    <nav
      v-if="menuOpen"
      id="mobile-navigation"
      aria-label="移动端导航"
      class="flex w-full flex-col rounded-2xl border border-line bg-surface p-2 sm:hidden"
      @keydown.esc="menuOpen = false"
    >
      <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="rounded-xl px-4 py-3">
        {{ link.label }}
      </NuxtLink>
    </nav>
  </header>
</template>
