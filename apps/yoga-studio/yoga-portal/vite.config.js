import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    watch: { usePolling: true },
    proxy: {
      '/api/yoga': {
        target: 'http://nginx:80',
        changeOrigin: true,
      },
    },
  },
})
