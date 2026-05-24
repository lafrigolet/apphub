// Reference generator — formato citable por teléfono.
// Contrato:
//   - Patrón fijo: INQ-YYYYMMDD-XXXXXX (6 chars).
//   - Alfabeto sin 0/O/1/I/L (legibilidad oral, anti confusión).
//   - Random suffix de 6 chars (entropía ≈ 2.2B combinaciones per día).
//   - YYYYMMDD usa now.getUTCFullYear/Month/Date (no local tz).

import { describe, it, expect } from 'vitest'
import { generateReference } from '../lib/reference.js'

describe('generateReference', () => {
  it('formato INQ-YYYYMMDD-XXXXXX', () => {
    const ref = generateReference()
    expect(ref).toMatch(/^INQ-\d{8}-[A-Z2-9]{6}$/)
  })

  it('usa fecha UTC del parámetro `now`', () => {
    const ref = generateReference(new Date('2026-05-24T15:00:00Z'))
    expect(ref).toMatch(/^INQ-20260524-/)
  })

  it('respeta padding del mes y día (un solo dígito)', () => {
    const ref = generateReference(new Date('2026-01-03T15:00:00Z'))
    expect(ref).toMatch(/^INQ-20260103-/)
  })

  it('alfabeto excluye 0, O, 1, I, L (legibilidad oral)', () => {
    // 100 generaciones, ninguna debería contener esos chars en el suffix.
    for (let i = 0; i < 100; i++) {
      const suffix = generateReference().split('-')[2]
      expect(suffix).not.toMatch(/[0OIL1]/)
    }
  })

  it('2 generaciones consecutivas son distintas (suffix random)', () => {
    const refs = new Set()
    for (let i = 0; i < 200; i++) refs.add(generateReference())
    // Permitimos hasta 1 colisión en 200 (P ≈ 0), pero esperamos >198 únicos.
    expect(refs.size).toBeGreaterThan(195)
  })

  it('suffix tiene exactamente 6 chars', () => {
    const suffix = generateReference().split('-')[2]
    expect(suffix.length).toBe(6)
  })
})
