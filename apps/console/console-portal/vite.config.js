import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    host: true,
    allowedHosts: [
      'console.hulkstein.local',
      'console.hulkstein.com',
      // Legacy aliases — kept while the rename propagates.
      'voragine-console.hulkstein.local',
      'voragine-console.hulkstein.com',
    ],
    proxy: {
      // Forward /api/* through the NGINX gateway. The Host header must match
      // a server_name block in NGINX, otherwise NGINX returns 444. We rewrite
      // it on the outgoing proxy request so dev access via localhost:5177
      // works the same as via console.hulkstein.local:8080.
      '/api': {
        target: 'http://nginx:80',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Host', 'console.hulkstein.local')
          })
        },
      },
    },
  },
})
