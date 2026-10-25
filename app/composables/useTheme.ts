export type Theme = 'dark' | 'light'

export function useTheme() {
  const theme = useState<Theme>('theme', () => 'dark')

  onMounted(() => {
    theme.value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  })

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme.value
    try {
      localStorage.setItem('xiaowork-theme', theme.value)
    } catch {
      // The active theme still works when browser storage is unavailable.
    }
  }

  return { theme: readonly(theme), toggleTheme }
}
