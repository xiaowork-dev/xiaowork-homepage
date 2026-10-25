// Run before first paint; the confirmed purple design is the default theme.
;(() => {
  let theme = 'dark'
  try {
    const saved = localStorage.getItem('xiaowork-theme')
    if (saved === 'dark' || saved === 'light') theme = saved
  } catch {
    // Storage may be disabled; retain the default theme.
  }
  document.documentElement.dataset.theme = theme
})()
