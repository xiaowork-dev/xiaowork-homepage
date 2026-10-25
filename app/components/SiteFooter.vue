<template>
  <footer class="border-t border-line">
    <div
      class="site-container flex flex-wrap items-center justify-between gap-4 py-7 text-sm text-subtle"
    >
      <p>© {{ new Date().getFullYear() }} XiaoWork</p>
      <NuxtLink to="/about" class="min-h-11 content-center hover:text-ink"
        >了解 XiaoWork →</NuxtLink
      >
    </div>
  </footer>
</template>
