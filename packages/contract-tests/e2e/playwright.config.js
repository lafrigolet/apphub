// Playwright config para los smokes E2E por subdominio (sección 4.5).
//
// NO se ejecuta en el pipeline por defecto (`pnpm test` / turbo solo corren
// test:unit + test:integration). Para correrlo:
//   pnpm --filter @apphub/contract-tests exec playwright install   # navegadores
//   pnpm --filter @apphub/contract-tests test:e2e
//
// Requiere los portales servidos detrás de NGINX (docker compose up -d) y los
// host entries de *.hulkstein.local. Override de hosts con E2E_*_URL.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: 0,
  reporter: 'list',
  use: {
    headless: true,
    ...devices['Desktop Chrome'],
  },
})
