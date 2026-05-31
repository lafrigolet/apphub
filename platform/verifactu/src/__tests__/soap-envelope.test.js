import { describe, it, expect } from 'vitest'
import {
  construirEnvelope, parseRespuesta, resolverEndpoint, ENDPOINTS, MAX_REGISTROS,
} from '../lib/soap-envelope.js'

const obligado = { nif: 'B12345678', nombre: 'Ejemplo S.L.' }
const registros = [{ tipo: 'alta', numSerie: '2027-A/000128', huella: 'ABC' }]

describe('construirEnvelope', () => {
  it('incluye Cabecera con NIF/Nombre del obligado y el registro', () => {
    const xml = construirEnvelope({ obligado, registros })
    expect(xml).toContain('RegFactuSistemaFacturacion')
    expect(xml).toContain('B12345678')
    expect(xml).toContain('Ejemplo S.L.')
    expect(xml).toContain('2027-A/000128')
    expect(xml).toContain('RegistroAlta')
  })

  it('añade Representante si se aporta', () => {
    const xml = construirEnvelope({ obligado, representante: { nif: 'B99', nombre: 'Gestoría' }, registros })
    expect(xml).toContain('Representante')
    expect(xml).toContain('Gestoría')
  })

  it('usa RegistroAnulacion para tipo anulacion', () => {
    const xml = construirEnvelope({ obligado, registros: [{ tipo: 'anulacion', numSerie: 'X', huella: 'H' }] })
    expect(xml).toContain('RegistroAnulacion')
  })

  it('tolera obligado sin nombre, representante sin nombre y registro sin campos', () => {
    const xml = construirEnvelope({
      obligado: { nif: 'B1' },
      representante: { nif: 'B2' },
      registros: [{}],
    })
    expect(xml).toContain('B1')
    expect(xml).toContain('B2')
    expect(xml).toContain('RegistroAlta')
  })

  it('lanza sin NIF del obligado', () => {
    expect(() => construirEnvelope({ obligado: {}, registros })).toThrow(/NIF/)
  })

  it('lanza con 0 registros', () => {
    expect(() => construirEnvelope({ obligado, registros: [] })).toThrow(/Sin registros/)
  })

  it(`lanza con más de ${MAX_REGISTROS} registros`, () => {
    const muchos = Array.from({ length: MAX_REGISTROS + 1 }, (_, i) => ({ numSerie: `S${i}`, huella: 'H' }))
    expect(() => construirEnvelope({ obligado, registros: muchos })).toThrow(/Máximo/)
  })
})

describe('resolverEndpoint', () => {
  it('test por defecto', () => {
    expect(resolverEndpoint()).toBe(ENDPOINTS.test)
  })
  it('prod', () => {
    expect(resolverEndpoint({ entorno: 'prod' })).toBe(ENDPOINTS.prod)
  })
  it('variante de sello', () => {
    expect(resolverEndpoint({ entorno: 'prod', sello: true })).toBe(ENDPOINTS.prod_sello)
  })
  it('entorno desconocido → test', () => {
    expect(resolverEndpoint({ entorno: 'yyy' })).toBe(ENDPOINTS.test)
  })
  it('sello sin variante disponible cae al entorno normal', () => {
    // test_sello no existe → cae a test
    expect(resolverEndpoint({ entorno: 'test', sello: false })).toBe(ENDPOINTS.test)
  })
})

const RESP_PARCIAL = `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body>
  <tikR:RespuestaRegFactuSistemaFacturacion xmlns:tikR="urn:aeat">
    <tikR:CSV>ABCD1234EFGH5678</tikR:CSV>
    <tikR:EstadoEnvio>ParcialmenteCorrecto</tikR:EstadoEnvio>
    <tikR:RespuestaLinea>
      <tikR:IDFactura><tikR:NumSerieFactura>2027-A/000128</tikR:NumSerieFactura></tikR:IDFactura>
      <tikR:EstadoRegistro>AceptadoConErrores</tikR:EstadoRegistro>
      <tikR:CodigoErrorRegistro>1100</tikR:CodigoErrorRegistro>
      <tikR:DescripcionErrorRegistro>aviso</tikR:DescripcionErrorRegistro>
    </tikR:RespuestaLinea>
    <tikR:TiempoEsperaEnvio>60</tikR:TiempoEsperaEnvio>
  </tikR:RespuestaRegFactuSistemaFacturacion>
</env:Body></env:Envelope>`

const RESP_CORRECTO = `<Envelope><Body><RespuestaRegFactuSistemaFacturacion>
  <EstadoEnvio>Correcto</EstadoEnvio><CSV>OK1</CSV></RespuestaRegFactuSistemaFacturacion></Body></Envelope>`

describe('parseRespuesta', () => {
  it('parsea CSV, EstadoEnvio, TiempoEsperaEnvio y la línea', () => {
    const r = parseRespuesta(RESP_PARCIAL)
    expect(r.estadoEnvio).toBe('ParcialmenteCorrecto')
    expect(r.csv).toBe('ABCD1234EFGH5678')
    expect(r.tiempoEsperaEnvio).toBe(60)
    expect(r.lineas).toHaveLength(1)
    expect(r.lineas[0]).toMatchObject({
      numSerie: '2027-A/000128', estado: 'AceptadoConErrores', codigoError: 1100,
    })
  })

  it('respuesta Correcto sin líneas → lineas vacío', () => {
    const r = parseRespuesta(RESP_CORRECTO)
    expect(r.estadoEnvio).toBe('Correcto')
    expect(r.csv).toBe('OK1')
    expect(r.lineas).toEqual([])
  })

  it('una sola RespuestaLinea (no array) se normaliza a array', () => {
    const r = parseRespuesta(RESP_PARCIAL)
    expect(Array.isArray(r.lineas)).toBe(true)
  })

  it('línea con NumSerieFactura plano (sin IDFactura)', () => {
    const xml = `<Body><RespuestaRegFactuSistemaFacturacion>
      <EstadoEnvio>Correcto</EstadoEnvio>
      <RespuestaLinea><NumSerieFactura>S/1</NumSerieFactura><EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea>
    </RespuestaRegFactuSistemaFacturacion></Body>`
    const r = parseRespuesta(xml)
    expect(r.lineas[0].numSerie).toBe('S/1')
  })

  it('XML sin estructura reconocible → estado null y lineas vacío', () => {
    const r = parseRespuesta('<Foo/>')
    expect(r.estadoEnvio).toBeNull()
    expect(r.lineas).toEqual([])
  })
})
