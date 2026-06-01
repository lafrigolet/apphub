import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage.mjs'

export default defineConfig({
  test: {
    exclude: ['**/integration/**', '**/node_modules/**'],
    coverage,
  },
})
