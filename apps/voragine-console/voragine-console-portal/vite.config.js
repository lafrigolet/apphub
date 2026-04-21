import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    host: true,
    allowedHosts: ['voragine-console.apphub.local'],
    proxy: {
      '/api': 'http://nginx:80',
    },
  },
})
