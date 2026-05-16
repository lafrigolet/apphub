import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5176,
    strictPort: true,
    allowedHosts: ['aikikan.hulkstein.local'],
    watch: { usePolling: true },
    proxy: {
      '/api': {
        target: 'http://nginx:80',
        changeOrigin: true,
      },
    },
  },
})
