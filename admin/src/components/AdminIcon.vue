<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  projects: 'M3 6h6l2 3h10v11H3z M3 9V5h6l2 3',
  categories: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  media: 'M3 3h18v18H3z M3 16l5-5 5 5 3-3 5 5 M16 7h.01',
  profile: 'M20 21v-2a7 7 0 0 0-14 0v2 M16 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0',
  settings:
    'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0',
  shield: 'M12 3l8 4v6c0 5-8 9-8 9S4 18 4 13V7z M9 12l2 2 4-4',
  logout: 'M10 4H4v16h6 M14 8l4 4-4 4 M8 12h12',
  moon: 'M21 12.8A9 9 0 0 1 11.2 3a9 9 0 1 0 9.8 9.8',
  sun: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5 M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'M6 6l12 12 M18 6L6 18',
  link: 'M14 3h7v7 M21 3L10 14 M10 4H3v17h17v-7',
}
</script>
<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.dashboard" />
  </svg>
</template>
