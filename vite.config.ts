import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('naive-ui')) return 'ui'
          if (id.includes('vue') || id.includes('pinia') || id.includes('@vueuse')) return 'vue'
          if (id.includes('dompurify')) return 'security'
          return 'vendor'
        }
      }
    }
  },
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main/index.ts',
        vite: { build: { rollupOptions: { external: ['better-sqlite3'] } } }
      },
      preload: { input: 'electron/preload/index.ts' },
      renderer: {}
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  },
  server: { port: 5173, strictPort: true }
})
