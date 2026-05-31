import { describe, it, expect } from 'vitest'
import { validarRegistro } from '../lib/validacion.js'
import { calcularHuella } from '../lib/huella.js'

const base = {
  idEmisor: 'B12345678', numSerie: '2027-A/000128', fechaExpedicion: '02-01-2027',
  tipoFactura: 'F1', cuotaTotal: '21.00', importeTotal: '121.00',
  generadoEn: '2027-01-02T10:15:30+01:00',
}

describe('validarRegistro', () => {
  it('registro completo con huella correcta → ok', () => {
    const reg = { ...base, huella: calcularHuella(base, null) }
    const r = validarRegistro(reg)
    expect(r.ok).toBe(true)
    expect(r.checks.some((c) => c.level === 'ok' && c.campo === 'huella')).toBe(true)
  })

  it('falta campo obligatorio → error', () => {
    const { numSerie, ...sinSerie } = base
    const r = validarRegistro(sinSerie)
    expect(r.ok).toBe(false)
    expect(r.checks.some((c) => c.level === 'error' && c.campo === 'numSerie')).toBe(true)
  })

  it('cuota > importe → error', () => {
    const r = validarRegistro({ ...base, cuotaTotal: '999.00' })
    expect(r.ok).toBe(false)
    expect(r.checks.some((c) => c.campo === 'cuotaTotal')).toBe(true)
  })

  it('huella declarada incorrecta → error', () => {
    const r = validarRegistro({ ...base, huella: 'DEADBEEF' })
    expect(r.ok).toBe(false)
    expect(r.checks.some((c) => c.level === 'error' && c.campo === 'huella')).toBe(true)
  })

  it('sin huella declarada → warn (no error)', () => {
    const r = validarRegistro(base)
    expect(r.ok).toBe(true)
    expect(r.checks.some((c) => c.level === 'warn' && c.campo === 'huella')).toBe(true)
  })

  it('registro vacío → varios errores', () => {
    const r = validarRegistro({})
    expect(r.ok).toBe(false)
    expect(r.checks.filter((c) => c.level === 'error').length).toBeGreaterThanOrEqual(4)
  })
})
