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
    // Proxy de /api → nginx para que el dev server (puerto 5184) sirva también
    // las llamadas a la API (login, cesta, reservas…). Sin esto, abrir la landing
    // directamente en :5184 devuelve 405 en los POST a /api (Vite solo sirve el SPA).
    proxy: {
      '/api': {
        target: 'http://nginx:80',
        // Forzamos el Host al server block de luciapassardi: el default_server
        // de nginx cierra la conexión (444 → "socket hang up") ante hosts
        // desconocidos, así que NO usamos changeOrigin (reescribiría a "nginx").
        changeOrigin: false,
        headers: { host: 'luciapassardi.hulkstein.local' },
      },
    },
  },
})
