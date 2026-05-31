import { describe, it, expect } from 'vitest'
import { generarQrDataUri } from '../lib/qr.js'

describe('generarQrDataUri', () => {
  it('devuelve un data URI PNG', async () => {
    const uri = await generarQrDataUri('https://x.test/ValidarQR?nif=B12345678')
    expect(uri.startsWith('data:image/png;base64,')).toBe(true)
    expect(uri.length).toBeGreaterThan(100)
  })

  it('es determinista para el mismo input', async () => {
    const a = await generarQrDataUri('texto-fijo')
    const b = await generarQrDataUri('texto-fijo')
    expect(a).toBe(b)
  })

  it('inputs distintos → QR distintos', async () => {
    const a = await generarQrDataUri('aaa')
    const b = await generarQrDataUri('bbb')
    expect(a).not.toBe(b)
  })

  it('acepta override de opciones (errorCorrectionLevel)', async () => {
    const uri = await generarQrDataUri('x', { errorCorrectionLevel: 'H' })
    expect(uri.startsWith('data:image/png;base64,')).toBe(true)
  })
})
