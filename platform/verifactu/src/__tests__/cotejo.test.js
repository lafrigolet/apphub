// URL de cotejo — composición y parseo.
// ⚠️ Dominio/parámetros marcados VERIFICAR (ver lib/cotejo.js). Estos tests
// blindan la composición (orden, formatos, encoding) y el roundtrip.

import { describe, it, expect } from 'vitest'
import { buildCotejoUrl, parseCotejoUrl, COTEJO_BASE } from '../lib/cotejo.js'

const args = { nif: 'B12345678', numSerie: '2027-A/000128', fecha: '02-01-2027', importe: '121.00' }

describe('buildCotejoUrl', () => {
  it('base de test por defecto + orden de parámetros nif,numserie,fecha,importe', () => {
    expect(buildCotejoUrl(args)).toBe(
      `${COTEJO_BASE.test}?nif=B12345678&numserie=2027-A%2F000128&fecha=02-01-2027&importe=121.00`,
    )
  })

  it('entorno prod usa la base de producción', () => {
    expect(buildCotejoUrl({ ...args, entorno: 'prod' })).toContain(COTEJO_BASE.prod + '?')
  })

  it('entorno desconocido cae a test', () => {
    expect(buildCotejoUrl({ ...args, entorno: 'xxx' })).toContain(COTEJO_BASE.test + '?')
  })

  it('URL-encodea los valores (la barra de numserie)', () => {
    expect(buildCotejoUrl(args)).toContain('numserie=2027-A%2F000128')
  })

  it('importe numérico se serializa con punto', () => {
    expect(buildCotejoUrl({ ...args, importe: 121.5 })).toContain('importe=121.5')
  })

  it('campos ausentes quedan vacíos', () => {
    expect(buildCotejoUrl({})).toBe(`${COTEJO_BASE.test}?nif=&numserie=&fecha=&importe=`)
  })
})

describe('parseCotejoUrl', () => {
  it('extrae los 4 parámetros', () => {
    expect(parseCotejoUrl(buildCotejoUrl(args))).toEqual({
      nif: 'B12345678', numSerie: '2027-A/000128', fecha: '02-01-2027', importe: '121.00',
    })
  })

  it('parámetros ausentes → null', () => {
    expect(parseCotejoUrl('https://x.test/ValidarQR')).toEqual({
      nif: null, numSerie: null, fecha: null, importe: null,
    })
  })

  it('roundtrip build→parse preserva nif y numSerie', () => {
    const p = parseCotejoUrl(buildCotejoUrl(args))
    expect(p.nif).toBe(args.nif)
    expect(p.numSerie).toBe(args.numSerie)
  })
})
