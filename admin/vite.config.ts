import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/admin/',
  publicDir: 'public',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
  },
})
