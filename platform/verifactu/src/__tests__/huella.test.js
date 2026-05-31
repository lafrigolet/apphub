// Huella VERI·FACTU — tests de composición y encadenamiento.
//
// ⚠️ Estos tests blindan la COMPOSICIÓN de la cadena (orden de campos,
// separador, reglas de formato) y las propiedades del hash (SHA-256, hex
// MAYÚS, determinismo, encadenamiento). El VECTOR DE TEST OFICIAL (cadena
// concreta → digest esperado del documento de la AEAT) está pendiente de
// confirmar — ver `it.todo` al final (TODO M2 en TODO-verifactu.md).

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

// VECTOR DE TEST OFICIAL — pendiente de confirmar el digest esperado contra el
// documento "Algoritmo de cálculo de codificación de la huella o hash" (AEAT).
// Cuando se tenga, fijar inputs del ejemplo oficial y assert del hash exacto.
it.todo('vector oficial AEAT: cadena del ejemplo → digest esperado')
