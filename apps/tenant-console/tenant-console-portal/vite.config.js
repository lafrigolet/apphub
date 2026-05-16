import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tenant-console serves all tenants from the same container; the host header
// distinguishes them at NGINX. allowedHosts must include the dev subdomain
// (`tenant-console.hulkstein.local`) plus a wildcard helper for per-tenant
// custom domains in dev. /api proxies through NGINX so the host header
// matching works the same as the staff console.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    host: true,
    allowedHosts: [
      'tenant-console.hulkstein.local',
      '.hulkstein.local',                    // covers per-tenant subdomains in dev
    ],
    proxy: {
      '/api': {
        target: 'http://nginx:80',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward whatever Host the browser used so a tenant accessing
            // bastardo.hulkstein.local hits its own server block in NGINX.
            // Fall back to tenant-console.hulkstein.local for direct dev.
            const host = req.headers.host || 'tenant-console.hulkstein.local'
            proxyReq.setHeader('Host', host.split(':')[0])
          })
        },
      },
    },
  },
})
