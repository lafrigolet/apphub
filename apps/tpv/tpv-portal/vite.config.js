import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5183,
    strictPort: true,
    allowedHosts: ['tpv.hulkstein.local'],
    watch: { usePolling: true },
    proxy: {
      // /api/* → gateway NGINX (rutas de plataforma: auth, payments).
      '/api': { target: 'http://nginx:80', changeOrigin: true },
    },
  },
})
