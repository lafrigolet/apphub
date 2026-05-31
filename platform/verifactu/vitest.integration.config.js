import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.test.js'],
    setupFiles: ['src/__tests__/integration/env-setup.js'],
    testTimeout: 20000,
    hookTimeout: 30000,
    sequence: { concurrent: false },
    // pino usa require() internos (./lib/caller, thread-stream) que el
    // transform de vitest rompe. Externalizamos pino y el SDK (que lo importa)
    // para que Node los cargue de forma nativa en vez de inline-transformarlos.
    server: { deps: { external: ['@apphub/platform-sdk', /pino/, 'thread-stream', 'sonic-boom'] } },
  },
})
