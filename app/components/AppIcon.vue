<script setup lang="ts">
defineProps<{
  name: 'arrow-right' | 'arrow-up-right' | 'github' | 'code' | 'layers' | 'spark' | 'menu' | 'close'
}>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="app-icon"
  >
    <path v-if="name === 'arrow-right'" d="M4 12h15m-6-6 6 6-6 6" />
    <path v-else-if="name === 'arrow-up-right'" d="M6 18 18 6M7 6h11v11" />
    <path v-else-if="name === 'code'" d="m7 6-5 6 5 6m10-12 5 6-5 6m-3-15-4 18" />
    <path
      v-else-if="name === 'layers'"
      d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"
    />
    <path
      v-else-if="name === 'spark'"
      d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z"
    />
    <path v-else-if="name === 'menu'" d="M4 6h16M4 12h16M4 18h16" />
    <path v-else-if="name === 'close'" d="m6 6 12 12M6 18 18 6" />
    <path
      v-else-if="name === 'github'"
      d="M9 19c-4.3 1.3-4.3-2.2-6-2.7m12 5v-3.4c0-.9-.3-1.5-.7-1.9 3.2-.4 6.7-1.6 6.7-7.1 0-1.6-.6-2.9-1.5-3.9.1-.4.6-1.8-.2-3.6 0 0-1.2-.4-3.9 1.5a13.5 13.5 0 0 0-7 0C5.7 1 4.5 1.4 4.5 1.4c-.8 1.8-.3 3.2-.2 3.6C3.4 6 2.8 7.3 2.8 8.9c0 5.5 3.5 6.7 6.7 7.1-.4.4-.7 1-.7 1.9v3.4"
    />
  </svg>
</template>
