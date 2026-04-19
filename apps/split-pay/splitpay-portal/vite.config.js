import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    host: true,
  },
  define: {
    'import.meta.env.VITE_APP_ID': JSON.stringify(process.env.VITE_APP_ID ?? 'split-pay'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env.VITE_API_BASE_URL ?? 'http://splitpay.apphub.local:8080'),
  },
})
