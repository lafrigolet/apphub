// E2E aikikan (4.5 · P0): magic-link login → MemberHome → logout.
// El token de magic-link se obtiene del backend de test (o se inyecta vía
// E2E_AIKIKAN_MAGIC_TOKEN, p.ej. capturado del email stub en CI).
import { test, expect } from '@playwright/test'

const BASE = process.env.E2E_AIKIKAN_URL ?? 'http://aikikan.hulkstein.local:8080'
const TOKEN = process.env.E2E_AIKIKAN_MAGIC_TOKEN

test('magic-link login → área de socio → logout', async ({ page }) => {
  test.skip(!TOKEN, 'requiere E2E_AIKIKAN_MAGIC_TOKEN (capturar del email stub en CI)')

  await page.goto(`${BASE}/magic-login?token=${TOKEN}`)
  // Aterriza en el área de socio (o consola si es admin).
  await expect(page).toHaveURL(/\/area-socio|\/consola/)

  // Si es socio: saludo + cerrar sesión.
  if (page.url().includes('/area-socio')) {
    await expect(page.getByText(/Hola,/)).toBeVisible()
    await page.getByRole('button', { name: /Cerrar sesión/ }).click()
    await expect(page).toHaveURL(BASE + '/')
  }
})

test('magic-link inválido → mensaje de enlace caducado', async ({ page }) => {
  await page.goto(`${BASE}/magic-login?token=token-invalido-e2e`)
  await expect(page.getByText(/Enlace caducado o usado|Enlace no válido/)).toBeVisible()
})
