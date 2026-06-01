import { defineConfig } from 'vitest/config'
import { coverage } from '../../vitest.coverage.mjs'

export default defineConfig({
  test: {
    exclude: ['**/integration/**', '**/node_modules/**'],
    coverage: {
      // Orquestador: su lógica ES server.js (boot/registro de módulos),
      // cubierto por server.test.js. Mantenemos el resto de exclusiones de
      // plumbing pero medimos server.js.
      ...coverage,
      exclude: coverage.exclude.filter((e) => e !== 'src/server.js'),
    },
  },
})
