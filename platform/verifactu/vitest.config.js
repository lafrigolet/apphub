import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/integration/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      // El `include` crece conforme se añaden tests unitarios (TODO M7/M8:
      // repositories, services). Hoy: lib puro/determinista. remision.js queda
      // fuera (I/O de red mTLS → cobertura por integración M11).
      include: [
        'src/lib/huella.js', 'src/lib/cotejo.js', 'src/lib/qr.js',
        'src/lib/cert.js', 'src/lib/firma.js', 'src/lib/soap-envelope.js',
        'src/lib/validacion.js', 'src/lib/cadena.js',
      ],
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
      reporter: ['text', 'json-summary'],
    },
  },
})
