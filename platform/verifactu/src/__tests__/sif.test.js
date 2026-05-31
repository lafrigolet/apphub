import { describe, it, expect } from 'vitest'
import {
  SIF_IDENTITY, EVENTOS_CATALOGO, esTipoValido, toneDe, construirEvento,
} from '../lib/sif.js'
import { huellaEvento } from '../lib/huella.js'

describe('catálogo de eventos', () => {
  it('SIF_IDENTITY tiene los campos del SistemaInformatico', () => {
    expect(SIF_IDENTITY).toMatchObject({ nif: expect.any(String), version: expect.any(String), numeroInstalacion: expect.any(String) })
  })
  it('esTipoValido distingue tipos del catálogo', () => {
    expect(esTipoValido('ARRANQUE')).toBe(true)
    expect(esTipoValido('NOPE')).toBe(false)
  })
  it('toneDe devuelve el tono del tipo (o azul por defecto)', () => {
    expect(toneDe('EXPORTACION')).toBe('emerald')
    expect(toneDe('DESCONOCIDO')).toBe('azul')
  })
  it('EVENTOS_CATALOGO no está vacío', () => {
    expect(EVENTOS_CATALOGO.length).toBeGreaterThan(0)
  })
})

describe('construirEvento', () => {
  const args = { tipoEvento: 'ARRANQUE', obligadoNif: 'B12345678', generadoEn: '2027-01-02T08:00:11+01:00' }

  it('produce tag/tone/descripcion por defecto + huella encadenada', () => {
    const ev = construirEvento(args, null)
    expect(ev.tag).toBe('ARRANQUE')
    expect(ev.tone).toBe('azul')
    expect(ev.descripcion).toContain('Inicio')
    expect(ev.huella).toMatch(/^[0-9A-F]{64}$/)
    expect(ev.huellaAnterior).toBeNull()
  })

  it('la huella coincide con huellaEvento(SistemaInformatico + obligado)', () => {
    const ev = construirEvento(args, 'PREV')
    const esperada = huellaEvento(
      {
        sifNif: SIF_IDENTITY.nif, sifId: SIF_IDENTITY.idSistemaInformatico,
        idSistemaInformatico: SIF_IDENTITY.idSistemaInformatico, version: SIF_IDENTITY.version,
        numeroInstalacion: SIF_IDENTITY.numeroInstalacion, nifObligado: 'B12345678',
        tipoEvento: 'ARRANQUE', generadoEn: args.generadoEn,
      },
      'PREV',
    )
    expect(ev.huella).toBe(esperada)
  })

  it('descripcion explícita anula la del catálogo', () => {
    const ev = construirEvento({ ...args, descripcion: 'custom' }, null)
    expect(ev.descripcion).toBe('custom')
  })

  it('encadena: distinta huella anterior → distinta huella', () => {
    expect(construirEvento(args, 'A').huella).not.toBe(construirEvento(args, 'B').huella)
  })
})
