import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/integration/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 30000,
    sequence: { concurrent: false },
  },
})
