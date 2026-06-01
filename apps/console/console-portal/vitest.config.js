import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/__tests__/**/*.test.js', 'src/**/__tests__/**/*.test.jsx'],
    exclude: ['**/integration/**', '**/node_modules/**'],
  },
})
