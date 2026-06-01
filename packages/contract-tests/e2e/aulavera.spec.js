// E2E aulavera (4.5 · P1): home → /proyectos → tabs cargan → /contacto →
// el formulario envía. Requiere el portal aulavera servido.
import { test, expect } from '@playwright/test'

const BASE = process.env.E2E_AULAVERA_URL ?? 'http://aulavera.hulkstein.local:8080'

test('home → proyectos → tabs → contacto → envía formulario', async ({ page }) => {
  await page.goto(BASE)
  await expect(page).toHaveTitle(/aulavera/i)

  // Proyectos: las 3 pestañas cargan.
  await page.goto(`${BASE}/proyectos`)
  await expect(page.getByText('Proyectos & actividades')).toBeVisible()
  await page.getByRole('button', { name: /Futuros/ }).click()
  await page.getByRole('button', { name: /Áreas de acción/ }).click()
  await page.getByRole('button', { name: /Realizados/ }).click()

  // Contacto: rellenar y enviar → toast de éxito.
  await page.goto(`${BASE}/contacto`)
  await page.getByLabel('Tu nombre').fill('E2E Tester')
  await page.getByLabel('Tu email').fill('e2e@example.com')
  await page.getByLabel('Tu mensaje').fill('Mensaje de prueba E2E')
  await page.getByText(/Acepto la/).click()
  await page.getByRole('button', { name: /Enviar mensaje/ }).click()
  await expect(page.getByText(/Mensaje recibido/)).toBeVisible()
})
