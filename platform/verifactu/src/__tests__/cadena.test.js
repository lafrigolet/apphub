import { describe, it, expect } from 'vitest'
import { verificarEnlace } from '../lib/cadena.js'

describe('verificarEnlace', () => {
  const cadena = [
    { numero: 1, huella: 'AAA', huellaAnterior: null },
    { numero: 2, huella: 'BBB', huellaAnterior: 'AAA' },
    { numero: 3, huella: 'CCC', huellaAnterior: 'BBB' },
  ]

  it('cadena bien enlazada → ok', () => {
    const r = verificarEnlace(cadena)
    expect(r.ok).toBe(true)
    expect(r.total).toBe(3)
    expect(r.rotos).toEqual([])
  })

  it('ordena por numero antes de verificar', () => {
    const desordenada = [cadena[2], cadena[0], cadena[1]]
    expect(verificarEnlace(desordenada).ok).toBe(true)
  })

  it('enlace roto → reporta el registro', () => {
    const rota = [cadena[0], { numero: 2, huella: 'BBB', huellaAnterior: 'XXX' }, cadena[2]]
    const r = verificarEnlace(rota)
    expect(r.ok).toBe(false)
    expect(r.rotos.map((x) => x.numero)).toContain(2)
  })

  it('primer registro con huella anterior → roto', () => {
    const r = verificarEnlace([{ numero: 1, huella: 'AAA', huellaAnterior: 'PREV' }])
    expect(r.ok).toBe(false)
    expect(r.rotos[0].numero).toBe(1)
  })

  it('cadena vacía → ok, total 0', () => {
    expect(verificarEnlace()).toEqual({ ok: true, total: 0, rotos: [] })
  })

  it('tolera registros sin numero/huellaAnterior (defaults)', () => {
    const r = verificarEnlace([{ huella: 'A' }, { huella: 'B', huellaAnterior: 'A' }])
    expect(r.ok).toBe(true)
    expect(r.total).toBe(2)
  })

  it('registro previo sin huella (undefined) → anterior cae a null (rama ?? null)', () => {
    // El 1er registro no tiene `huella`; el 2º declara huellaAnterior null →
    // `orden[i-1].huella ?? null` resuelve a null y enlaza (null === null).
    const r = verificarEnlace([
      { numero: 1, huellaAnterior: null },
      { numero: 2, huella: 'B', huellaAnterior: null },
    ])
    expect(r.ok).toBe(true)
    expect(r.total).toBe(2)
  })
})
