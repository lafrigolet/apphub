// Huella VERI·FACTU — tests de composición y encadenamiento.
//
// Estos tests blindan la COMPOSICIÓN de la cadena (orden de campos,
// separador, reglas de formato) y las propiedades del hash (SHA-256, hex
// MAYÚS, determinismo, encadenamiento). El VECTOR DE TEST OFICIAL de la AEAT
// (cadena concreta → digest esperado del documento "Algoritmo de cálculo de
// codificación de la huella o hash") está BLINDADO en el bloque
// `vector oficial AEAT` al final: el ejemplo `89890001K / 12345678/G33` con su
// digest `3C46…2F60`. Cualquier cambio de orden/formato/separador rompe ese
// test. Fuente: doc oficial AEAT (reproducido por la lib de referencia
// mdiago/VeriFactu y Zoho Books).

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  TIPO_HUELLA,
  cadenaAlta, huellaAlta,
  cadenaAnulacion, huellaAnulacion,
  cadenaEvento, huellaEvento,
  calcularHuella,
} from '../lib/huella.js'

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').toUpperCase()
const HEX64 = /^[0-9A-F]{64}$/

const alta = {
  idEmisor: 'B12345678',
  numSerie: '2027-A/000128',
  fechaExpedicion: '02-01-2027',
  tipoFactura: 'F1',
  cuotaTotal: '21.00',
  importeTotal: '121.00',
  generadoEn: '2027-01-02T10:15:30+01:00',
}

describe('TIPO_HUELLA', () => {
  it('es 01 (SHA-256)', () => {
    expect(TIPO_HUELLA).toBe('01')
  })
})

describe('cadenaAlta — composición', () => {
  it('orden de campos y formato clave=valor&...', () => {
    expect(cadenaAlta(alta, '3C9F0AB1')).toBe(
      'IDEmisorFactura=B12345678&NumSerieFactura=2027-A/000128&' +
      'FechaExpedicionFactura=02-01-2027&TipoFactura=F1&CuotaTotal=21.00&' +
      'ImporteTotal=121.00&Huella=3C9F0AB1&FechaHoraHusoGenRegistro=2027-01-02T10:15:30+01:00',
    )
  })

  it('primer registro: Huella anterior vacía → "Huella="', () => {
    expect(cadenaAlta(alta, null)).toContain('&Huella=&FechaHoraHusoGenRegistro=')
  })

  it('campo ausente se incluye como "clave="', () => {
    const { cuotaTotal, ...sinCuota } = alta
    expect(cadenaAlta(sinCuota, '')).toContain('&CuotaTotal=&ImporteTotal=121.00&')
  })

  it('recorta espacios de los valores', () => {
    const c = cadenaAlta({ ...alta, numSerie: '  2027-A/000128  ' }, '')
    expect(c).toContain('NumSerieFactura=2027-A/000128&')
  })
})

describe('huellaAlta', () => {
  it('es SHA-256 hex MAYÚSCULAS de la cadena', () => {
    const h = huellaAlta(alta, '3C9F0AB1')
    expect(h).toBe(sha(cadenaAlta(alta, '3C9F0AB1')))
    expect(h).toMatch(HEX64)
  })

  it('es determinista', () => {
    expect(huellaAlta(alta, 'X')).toBe(huellaAlta(alta, 'X'))
  })

  it('encadena: distinta huella anterior → distinta huella', () => {
    expect(huellaAlta(alta, 'A')).not.toBe(huellaAlta(alta, 'B'))
  })

  it('cambia si cambia cualquier campo', () => {
    expect(huellaAlta(alta, 'A')).not.toBe(huellaAlta({ ...alta, importeTotal: '121.01' }, 'A'))
  })
})

describe('RegistroAnulacion', () => {
  const anul = {
    idEmisor: 'B12345678', numSerie: '2027-A/000126',
    fechaExpedicion: '01-01-2027', generadoEn: '2027-01-02T11:00:00+01:00',
  }
  it('cadena con campos *Anulada y Huella anterior', () => {
    expect(cadenaAnulacion(anul, 'PREV')).toBe(
      'IDEmisorFacturaAnulada=B12345678&NumSerieFacturaAnulada=2027-A/000126&' +
      'FechaExpedicionFacturaAnulada=01-01-2027&Huella=PREV&' +
      'FechaHoraHusoGenRegistro=2027-01-02T11:00:00+01:00',
    )
  })
  it('huella = SHA-256 upper de su cadena', () => {
    expect(huellaAnulacion(anul, 'PREV')).toBe(sha(cadenaAnulacion(anul, 'PREV')))
  })
})

describe('RegistroEvento', () => {
  const ev = {
    sifNif: 'B87654321', sifId: '01', idSistemaInformatico: '01', version: '1.0',
    numeroInstalacion: '0001', nifObligado: 'B12345678', tipoEvento: 'ARRANQUE',
    generadoEn: '2027-01-02T08:00:11+01:00',
  }
  it('cadena con campos de SistemaInformatico + evento', () => {
    expect(cadenaEvento(ev, 'PREVEV')).toBe(
      'NIF=B87654321&ID=01&IdSistemaInformatico=01&Version=1.0&NumeroInstalacion=0001&' +
      'NIFObligado=B12345678&TipoEvento=ARRANQUE&HuellaEvento=PREVEV&' +
      'FechaHoraHusoGenEvento=2027-01-02T08:00:11+01:00',
    )
  })
  it('huella = SHA-256 upper de su cadena', () => {
    expect(huellaEvento(ev, 'PREVEV')).toBe(sha(cadenaEvento(ev, 'PREVEV')))
  })
})

describe('calcularHuella (dispatcher)', () => {
  it('tipo "alta" (o por defecto) → huellaAlta', () => {
    expect(calcularHuella({ ...alta, tipo: 'alta' }, 'A')).toBe(huellaAlta(alta, 'A'))
    expect(calcularHuella({ ...alta }, 'A')).toBe(huellaAlta(alta, 'A'))
  })
  it('tipo "anulacion" → huellaAnulacion', () => {
    const r = { ...alta, tipo: 'anulacion' }
    expect(calcularHuella(r, 'A')).toBe(huellaAnulacion(r, 'A'))
  })
})

// ── VECTOR DE TEST OFICIAL AEAT ───────────────────────────────────────
// Ejemplo del documento oficial "Algoritmo de cálculo de codificación de la
// huella o hash" de la AEAT (reproducido por mdiago/VeriFactu y Zoho Books):
//   IDEmisorFactura=89890001K, NumSerieFactura=12345678/G33,
//   FechaExpedicionFactura=01-01-2024, TipoFactura=F1, CuotaTotal=12.35,
//   ImporteTotal=123.45, Huella= (primer registro),
//   FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00
// → SHA-256 hex MAYÚS = 3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60
//
// Blinda el algoritmo (orden de campos + separador + formato + casing) contra
// regresiones: si alguien reordena un campo o cambia el separador, este test
// falla. Riesgo #1 de la priorización: sin esto el módulo no puede ir a prod.
describe('vector oficial AEAT', () => {
  const oficial = {
    idEmisor: '89890001K',
    numSerie: '12345678/G33',
    fechaExpedicion: '01-01-2024',
    tipoFactura: 'F1',
    cuotaTotal: '12.35',
    importeTotal: '123.45',
    generadoEn: '2024-01-01T19:20:30+01:00',
  }
  const DIGEST_OFICIAL = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60'

  it('cadena del ejemplo oficial', () => {
    expect(cadenaAlta(oficial, null)).toBe(
      'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&' +
      'FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&' +
      'ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00',
    )
  })

  it('huella = digest oficial 3C46…2F60', () => {
    expect(huellaAlta(oficial, null)).toBe(DIGEST_OFICIAL)
  })

  it('dispatcher calcularHuella reproduce el digest oficial', () => {
    expect(calcularHuella({ ...oficial, tipo: 'alta' }, null)).toBe(DIGEST_OFICIAL)
  })
})

// ── VECTOR DE ENCADENAMIENTO (hash chain) ─────────────────────────────
// Comprueba que el 2º registro encadena con la huella del 1º (la del vector
// oficial) y que el resultado es estable/determinista. Estos digests son
// AUTO-CALCULADOS por nuestra implementación: fijan el contrato de
// encadenamiento (no son del documento AEAT, que solo publica el 1er eslabón).
describe('vector de encadenamiento', () => {
  const r1 = {
    idEmisor: '89890001K', numSerie: '12345678/G33', fechaExpedicion: '01-01-2024',
    tipoFactura: 'F1', cuotaTotal: '12.35', importeTotal: '123.45',
    generadoEn: '2024-01-01T19:20:30+01:00',
  }
  const H1 = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60'
  const r2 = {
    idEmisor: '89890001K', numSerie: '12345678/G34', fechaExpedicion: '01-01-2024',
    tipoFactura: 'F1', cuotaTotal: '12.35', importeTotal: '123.45',
    generadoEn: '2024-01-01T19:21:30+01:00',
  }

  it('el 2º registro incluye la huella del 1º en su cadena', () => {
    expect(cadenaAlta(r2, H1)).toContain(`&Huella=${H1}&FechaHoraHusoGenRegistro=`)
  })

  it('huella encadenada del 2º registro (determinista)', () => {
    const h2 = huellaAlta(r2, H1)
    expect(h2).toMatch(HEX64)
    expect(h2).toBe(huellaAlta(r2, H1)) // determinista
    // si el eslabón anterior cambia, la huella cambia (tamper-evidence)
    expect(h2).not.toBe(huellaAlta(r2, 'OTRA_HUELLA'))
  })

  it('una anulación que referencia la huella anterior es determinista', () => {
    const anul = {
      idEmisor: '89890001K', numSerie: '12345678/G33', fechaExpedicion: '01-01-2024',
      generadoEn: '2024-01-02T09:00:00+01:00',
    }
    const ha = huellaAnulacion(anul, H1)
    expect(ha).toMatch(HEX64)
    expect(ha).toBe(huellaAnulacion(anul, H1))
    expect(ha).not.toBe(huellaAnulacion(anul, null))
  })
})
