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
    port: 5173,
    strictPort: true,
    // Vite 5 rejects unknown Host headers by default. The landing is
    // served at the apex — hulkstein.local in dev, hulkstein.com in prod.
    // Dev traffic comes through nginx with the public Host preserved,
    // so we whitelist both.
    allowedHosts: ['hulkstein.local', 'hulkstein.com', 'www.hulkstein.com'],
    watch: {
      usePolling: true,
    },
  },
})
