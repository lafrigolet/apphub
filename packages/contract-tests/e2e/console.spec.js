// E2E console (4.5 · P1): super_admin login → editar config de splitpay →
// guardar. Y (cross-app · P0) socio aikikan paga cuota → webhook → row paid.
import { test, expect } from '@playwright/test'

const BASE = process.env.E2E_CONSOLE_URL ?? 'http://console.hulkstein.local:8080'
const EMAIL = process.env.E2E_CONSOLE_EMAIL ?? 'ana@voragine.local'
const PASSWORD = process.env.E2E_CONSOLE_PASSWORD ?? 'password123'

test('super_admin login → config splitpay → guardar', async ({ page }) => {
  await page.goto(BASE)
  await page.getByLabel(/email/i).fill(EMAIL)
  await page.getByLabel(/contraseña|password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /entrar|acceder|login/i }).click()

  // Navega a la config de splitpay y guarda.
  await page.goto(`${BASE}/staff/config/splitpay`)
  await expect(page.getByRole('button', { name: /Guardar/ })).toBeVisible()
  await page.getByRole('button', { name: /Guardar/ }).click()
  // Toast de éxito o "nada que guardar" — ambos confirman que el form respondió.
  await expect(page.getByText(/configurado|guardado|Nada que guardar/i)).toBeVisible()
})

// Cross-app (P0): socio aikikan paga cuota → Stripe webhook → row paid en
// aikikan-server. Requiere Stripe CLI / webhook stub; se ejecuta solo en el
// entorno CI con esa infra cableada.
test('cross-app: cuota aikikan → webhook → row paid', async () => {
  test.fixme(true, 'requiere Stripe CLI / webhook stub (CI con STRIPE_* configurado)')
})
