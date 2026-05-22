import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.test.js'],
    setupFiles: ['src/__tests__/integration/env-setup.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: { concurrent: false },
  },
})
