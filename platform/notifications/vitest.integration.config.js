import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.test.js'],
    setupFiles: ['src/__tests__/integration/env-setup.js'],
    testTimeout: 15000,
    hookTimeout: 20000,
    sequence: { concurrent: false },
  },
})
