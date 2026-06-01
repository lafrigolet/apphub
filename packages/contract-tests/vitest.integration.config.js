import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/integration/**/*.integration.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: { concurrent: false },
  },
})
