<template>
  <div class="flex min-h-screen flex-col">
    <a href="#main-content" class="skip-link">跳转到主要内容</a>
    <SiteHeader />
    <main id="main-content" class="site-container flex-1 pb-16" tabindex="-1">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
