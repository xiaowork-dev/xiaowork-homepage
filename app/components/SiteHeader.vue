<script setup lang="ts">
const menuOpen = ref(false)
const menuButton = useTemplateRef<HTMLButtonElement>('menuButton')
function closeMenu() {
  menuOpen.value = false
  menuButton.value?.focus()
}
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
  <header class="site-container site-header">
    <NuxtLink to="/" class="brand" aria-label="XiaoWork 首页">
      XiaoWork<span class="text-accent">.</span>
    </NuxtLink>
    <div class="flex items-center gap-3 sm:gap-6">
      <nav aria-label="主导航" class="hidden items-center gap-2 sm:flex">
        <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="nav-link">{{
          link.label
        }}</NuxtLink>
      </nav>
      <ThemeToggle />
      <button
        ref="menuButton"
        type="button"
        class="menu-button"
        :aria-expanded="menuOpen"
        aria-controls="mobile-navigation"
        @click="menuOpen = !menuOpen"
        @keydown.esc="closeMenu"
      >
        <AppIcon :name="menuOpen ? 'close' : 'menu'" />
        {{ menuOpen ? '关闭' : '菜单' }}
      </button>
    </div>
    <nav
      v-if="menuOpen"
      id="mobile-navigation"
      aria-label="移动端导航"
      class="mobile-navigation"
      @keydown.esc="closeMenu"
    >
      <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="nav-link">
        {{ link.label }}
      </NuxtLink>
    </nav>
  </header>
</template>
