import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.js', 'src/**/__tests__/**/*.test.jsx'],
    exclude: ['**/integration/**', '**/node_modules/**'],
  },
})
