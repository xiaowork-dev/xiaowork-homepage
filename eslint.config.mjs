import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  ignores: ['.output/**', 'dist/**', '.deploy/**', '.cache/**', 'coverage/**'],
  rules: {
    'vue/html-self-closing': [
      'error',
      { html: { void: 'always', normal: 'always', component: 'always' } },
    ],
  },
})
