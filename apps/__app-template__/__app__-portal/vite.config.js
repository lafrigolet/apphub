import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// STEP: set port to next available frontend port (5176+)
// STEP: set VITE_APP_ID to the new app's id (e.g. 'restaurant')
// STEP: set VITE_API_BASE_URL to '{app}.hulkstein.local:8080' for local dev
export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.PORT ?? '5176'),
    host: true,
  },
  define: {
    'import.meta.env.VITE_APP_ID': JSON.stringify(process.env.VITE_APP_ID ?? '__app__'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env.VITE_API_BASE_URL ?? 'http://__app__.hulkstein.local:8080'),
  },
})
