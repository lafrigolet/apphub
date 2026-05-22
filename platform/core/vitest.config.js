import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/integration/**', '**/node_modules/**'],
    setupFiles: ['src/__tests__/env-setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/bootstrap.js', 'src/__tests__/**'],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
})
