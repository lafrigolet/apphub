import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage.mjs'

export default defineConfig({
  test: {
    exclude: ['**/integration/**', '**/node_modules/**'],
    coverage: {
      ...coverage,
      // remision.js hace I/O de red mTLS contra AEAT → cobertura por
      // integración (M11), fuera del unit.
      exclude: [...coverage.exclude, 'src/lib/remision.js'],
    },
  },
})
