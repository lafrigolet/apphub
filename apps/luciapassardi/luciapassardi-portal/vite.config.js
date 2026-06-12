import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5184,
    strictPort: true,
    allowedHosts: ['luciapassardi.hulkstein.local'],
    watch: { usePolling: true },
  },
})
