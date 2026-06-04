// verifactu.service — wiring de mutaciones/lecturas sobre repo + libs.
// Mockea db (tx), repo y las libs puras (huella, cotejo, qr, validación,
// cadena, sif) para asentar el CONTRATO de orquestación:
//   - crearRegistro: numero = max+1, huella encadenada con lastHuella,
//     idEmisor = nif del obligado (config), numSerie por defecto.
//   - crearEvento: encadena con lastHuellaEvento.
//   - cotejar: verificada ⇔ existe registro por num_serie; persiste resultado.
//   - getQr: sin registro → null; con registro → genera data URI.
//   - verificarCadena: mapea filas y delega en verificarEnlace.
//   - getConfig: defaults cuando no hay row; patchConfig mapea camelCase.
//   - validar: usa el registro aportado (o una muestra).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../repositories/verifactu.repository.js')
vi.mock('../lib/huella.js', () => ({ calcularHuella: vi.fn(() => 'HUELLA_X'), TIPO_HUELLA: '01' }))
vi.mock('../lib/cotejo.js', () => ({ buildCotejoUrl: vi.fn(() => 'http://cotejo/url'), parseCotejoUrl: vi.fn(() => ({})) }))
vi.mock('../lib/qr.js', () => ({ generarQrDataUri: vi.fn(async () => 'data:image/png;base64,ZZ') }))
vi.mock('../lib/validacion.js', () => ({ validarRegistro: vi.fn(() => ({ ok: true })) }))
vi.mock('../lib/cadena.js', () => ({ verificarEnlace: vi.fn(() => ({ valida: true, rota: null })) }))
vi.mock('../lib/sif.js', () => ({
  construirEvento: vi.fn(() => ({ tag: 'ALTA', tone: 'ok', descripcion: 'desc', huella: 'EVH', huellaAnterior: 'EPREV' })),
  EVENTOS_CATALOGO: [{ tipo: 'alta' }],
}))

import * as service from '../services/verifactu.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/verifactu.repository.js'
import { calcularHuella } from '../lib/huella.js'
import { buildCotejoUrl, parseCotejoUrl } from '../lib/cotejo.js'
import { generarQrDataUri } from '../lib/qr.js'
import { validarRegistro } from '../lib/validacion.js'
import { verificarEnlace } from '../lib/cadena.js'
import { construirEvento } from '../lib/sif.js'

const scope = { appId: 'aikikan', tenantId: 't1', subTenantId: null }
const client = { query: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn(client))
})

describe('crearRegistro — huella encadenada', () => {
  it('numero = maxNumero+1, encadena con lastHuella, idEmisor = nif del obligado', async () => {
    repo.maxNumero.mockResolvedValue(5)
    repo.lastHuella.mockResolvedValue('PREV_HUELLA')
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B12345678', nombre_obligado: 'Obligado SL' })
    repo.insertRegistro.mockResolvedValue({
      num_serie: '2027-A/000006', cliente_nombre: 'Ana', fecha_expedicion: '02-01-2027',
      total_display: '121,00 €', estado_remision: 'pendiente', huella: 'HUELLA_X',
    })

    const out = await service.crearRegistro(scope, { importeTotal: 121, cuotaTotal: 21, fechaExpedicion: '02-01-2027' })

    // huella encadenada: 2º argumento = huella anterior
    expect(calcularHuella).toHaveBeenCalledWith(
      expect.objectContaining({ idEmisor: 'B12345678', numSerie: '2027-A/000006' }),
      'PREV_HUELLA',
    )
    // persistencia con numero incrementado + huella + qr
    expect(repo.insertRegistro).toHaveBeenCalledWith(client, expect.objectContaining({
      numero: 6, numSerie: '2027-A/000006', huella: 'HUELLA_X', huellaAnterior: 'PREV_HUELLA', qrUrl: 'http://cotejo/url',
    }))
    expect(out.huella).toBe('HUELLA_X')
  })

  it('primer registro: lastHuella null → encadena con null (PrimerRegistro)', async () => {
    repo.maxNumero.mockResolvedValue(0)
    repo.lastHuella.mockResolvedValue(null)
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.insertRegistro.mockResolvedValue({})
    await service.crearRegistro(scope, { importeTotal: 10 })
    expect(calcularHuella).toHaveBeenCalledWith(expect.any(Object), null)
    expect(repo.insertRegistro).toHaveBeenCalledWith(client, expect.objectContaining({ numero: 1 }))
  })

  it('respeta numSerie aportado', async () => {
    repo.maxNumero.mockResolvedValue(0)
    repo.lastHuella.mockResolvedValue(null)
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.insertRegistro.mockResolvedValue({})
    await service.crearRegistro(scope, { numSerie: 'CUSTOM-1', importeTotal: 10 })
    expect(repo.insertRegistro).toHaveBeenCalledWith(client, expect.objectContaining({ numSerie: 'CUSTOM-1' }))
  })

  it('cfg null → idEmisor cae a input.clienteNif + tipo explícito (anulación con ref válida)', async () => {
    repo.maxNumero.mockResolvedValue(0)
    repo.lastHuella.mockResolvedValue(null)
    repo.getConfig.mockResolvedValue(null)
    repo.contarPorNumSerie.mockResolvedValue({ alta: 1, anulacion: 0 })
    repo.insertRegistro.mockResolvedValue({})
    await service.crearRegistro(scope, {
      clienteNif: 'C123', importeTotal: 10, tipo: 'anulacion', tipoFactura: 'F2',
      numSerieAnulada: '2027-A/000010',
    })
    expect(calcularHuella).toHaveBeenCalledWith(
      expect.objectContaining({ idEmisor: 'C123', tipo: 'anulacion', tipoFactura: 'F2', numSerie: '2027-A/000010' }),
      null,
    )
    expect(buildCotejoUrl).toHaveBeenCalledWith(expect.objectContaining({ nif: 'C123' }))
  })
})

describe('crearRegistro — reglas de negocio de anulación (§2)', () => {
  beforeEach(() => {
    repo.maxNumero.mockResolvedValue(0)
    repo.lastHuella.mockResolvedValue(null)
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.insertRegistro.mockResolvedValue({})
  })

  it('anulación sin referencia → ANULACION_SIN_REF', async () => {
    await expect(service.crearRegistro(scope, { tipo: 'anulacion', importeTotal: 10 }))
      .rejects.toMatchObject({ code: 'ANULACION_SIN_REF' })
    expect(repo.insertRegistro).not.toHaveBeenCalled()
  })

  it('anulación de factura inexistente → ANULACION_NO_CONSTA', async () => {
    repo.contarPorNumSerie.mockResolvedValue({ alta: 0, anulacion: 0 })
    await expect(service.crearRegistro(scope, { tipo: 'anulacion', numSerieAnulada: 'A/404' }))
      .rejects.toMatchObject({ code: 'ANULACION_NO_CONSTA' })
  })

  it('anulación de factura ya anulada → ANULACION_DUPLICADA', async () => {
    repo.contarPorNumSerie.mockResolvedValue({ alta: 1, anulacion: 1 })
    await expect(service.crearRegistro(scope, { tipo: 'anulacion', numSerieAnulada: 'A/1' }))
      .rejects.toMatchObject({ code: 'ANULACION_DUPLICADA' })
  })

  it('anulación válida → el num_serie del registro referencia la factura anulada', async () => {
    repo.contarPorNumSerie.mockResolvedValue({ alta: 1, anulacion: 0 })
    await service.crearRegistro(scope, { tipo: 'anulacion', numSerieAnulada: 'A/7' })
    expect(repo.contarPorNumSerie).toHaveBeenCalledWith(client, 'A/7')
    expect(repo.insertRegistro).toHaveBeenCalledWith(client, expect.objectContaining({ tipo: 'anulacion', numSerie: 'A/7' }))
  })
})

describe('crearRegistro — serie correlativa (§14)', () => {
  beforeEach(() => {
    repo.maxNumero.mockResolvedValue(0)
    repo.lastHuella.mockResolvedValue(null)
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.insertRegistro.mockResolvedValue({})
  })

  it('serie activa → reserva el correlativo atómico y compone num_serie', async () => {
    repo.reservarNumeroSerie.mockResolvedValue({ codigo: 'VENTAS', numero: 42 })
    await service.crearRegistro(scope, { serie: 'VENTAS', importeTotal: 10 })
    expect(repo.reservarNumeroSerie).toHaveBeenCalledWith(client, 'VENTAS')
    expect(repo.insertRegistro).toHaveBeenCalledWith(client, expect.objectContaining({ numSerie: 'VENTAS/000042' }))
  })

  it('serie inexistente o cerrada → SERIE_INACTIVA', async () => {
    repo.reservarNumeroSerie.mockResolvedValue(null)
    await expect(service.crearRegistro(scope, { serie: 'CERRADA', importeTotal: 10 }))
      .rejects.toMatchObject({ code: 'SERIE_INACTIVA' })
  })
})

describe('crearEvento — encadena con lastHuellaEvento', () => {
  it('construirEvento recibe la huella del último evento + persiste', async () => {
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.lastHuellaEvento.mockResolvedValue('EPREV')
    repo.insertEvento.mockResolvedValue({ tag: 'ALTA', tone: 'ok', descripcion: 'desc', ts_display: 'ahora', huella: 'EVH' })
    const out = await service.crearEvento(scope, { tipoEvento: 'alta', descripcion: 'desc' })
    expect(construirEvento).toHaveBeenCalledWith(
      expect.objectContaining({ tipoEvento: 'alta', descripcion: 'desc', obligadoNif: 'B1' }),
      'EPREV',
    )
    expect(repo.insertEvento).toHaveBeenCalled()
    expect(out.huella).toBe('EVH')
  })

  it('cfg null → obligadoNif undefined (rama cfg?.nif_obligado)', async () => {
    repo.getConfig.mockResolvedValue(null)
    repo.lastHuellaEvento.mockResolvedValue(null)
    repo.insertEvento.mockResolvedValue({ tag: 'X', tone: 'ok', descripcion: 'd', ts_display: 'ahora', huella: 'H' })
    await service.crearEvento(scope, { tipoEvento: 'alta', descripcion: 'd' })
    expect(construirEvento).toHaveBeenCalledWith(
      expect.objectContaining({ obligadoNif: undefined }),
      null,
    )
  })
})

describe('cotejar — verificación contra la cadena local', () => {
  it('num_serie existe → verificada + resultado "verificada"', async () => {
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1', nombre_obligado: 'Obligado' })
    repo.findByNumSerie.mockResolvedValue({ num_serie: '2027-A/1', total_display: '121,00 €' })
    repo.insertCotejo.mockResolvedValue({ resultado: 'verificada', num_serie: '2027-A/1' })
    const out = await service.cotejar(scope, { numSerie: '2027-A/1' })
    expect(out.verificada).toBe(true)
    expect(out.emisor).toMatchObject({ nif: 'B1' })
    expect(repo.insertCotejo).toHaveBeenCalledWith(client, expect.objectContaining({ resultado: 'verificada', tone: 'ok' }))
  })

  it('num_serie no existe → no verificada + resultado "no_consta"', async () => {
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.findByNumSerie.mockResolvedValue(null)
    repo.insertCotejo.mockResolvedValue({ resultado: 'no_consta', num_serie: 'X' })
    const out = await service.cotejar(scope, { numSerie: 'X' })
    expect(out.verificada).toBe(false)
    expect(out.emisor).toBeNull()
    expect(repo.insertCotejo).toHaveBeenCalledWith(client, expect.objectContaining({ resultado: 'no_consta', tone: 'rose' }))
  })

  it('url de cotejo → se parsea para extraer numSerie/nif', async () => {
    parseCotejoUrl.mockReturnValue({ numSerie: '2027-A/9', nif: 'B9' })
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.findByNumSerie.mockResolvedValue({ num_serie: '2027-A/9' })
    repo.insertCotejo.mockResolvedValue({ resultado: 'verificada', num_serie: '2027-A/9' })
    await service.cotejar(scope, { url: 'https://aeat/cotejo?...' })
    expect(parseCotejoUrl).toHaveBeenCalledWith('https://aeat/cotejo?...')
    expect(repo.findByNumSerie).toHaveBeenCalledWith(client, '2027-A/9')
  })

  it('cfg=null + verificada → emisor "Obligado"/nifEmisor del input', async () => {
    repo.getConfig.mockResolvedValue(null)
    repo.findByNumSerie.mockResolvedValue({ num_serie: 'A/1', total_display: '50,00 €' })
    repo.insertCotejo.mockResolvedValue({ resultado: 'verificada', num_serie: 'A/1' })
    const out = await service.cotejar(scope, { numSerie: 'A/1', nifEmisor: 'B7' })
    expect(out.emisor).toEqual({ nombre: 'Obligado', nif: 'B7' })
    expect(out.importe).toBe('50,00 €')
    expect(repo.insertCotejo).toHaveBeenCalledWith(client, expect.objectContaining({ nifEmisor: 'B7' }))
  })

  it('sin numSerie ni url → findByNumSerie NO se llama; nifEmisor cae a cfg', async () => {
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.insertCotejo.mockResolvedValue({ resultado: 'no_consta', num_serie: null })
    const out = await service.cotejar(scope, {})
    expect(repo.findByNumSerie).not.toHaveBeenCalled()
    expect(out.verificada).toBe(false)
    expect(repo.insertCotejo).toHaveBeenCalledWith(client, expect.objectContaining({ nifEmisor: 'B1' }))
  })

  it('url presente pero parseCotejoUrl vacío → numSerie/nifEmisor caen al input (rama ?? derecha)', async () => {
    // parseCotejoUrl devuelve {} → `p.numSerie ?? numSerie` y `p.nif ?? nifEmisor`
    // resuelven por el lado derecho (los valores del input).
    parseCotejoUrl.mockReturnValue({})
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.findByNumSerie.mockResolvedValue({ num_serie: 'A/5' })
    repo.insertCotejo.mockResolvedValue({ resultado: 'verificada', num_serie: 'A/5' })
    await service.cotejar(scope, { url: 'https://aeat/cotejo?x', numSerie: 'A/5', nifEmisor: 'B5' })
    expect(repo.findByNumSerie).toHaveBeenCalledWith(client, 'A/5')
    expect(repo.insertCotejo).toHaveBeenCalledWith(client, expect.objectContaining({ nifEmisor: 'B5' }))
  })

  it('sin nifEmisor en input y cfg=null → nifEmisor null (rama ?? null final)', async () => {
    repo.getConfig.mockResolvedValue(null)
    repo.insertCotejo.mockResolvedValue({ resultado: 'no_consta', num_serie: null })
    await service.cotejar(scope, {})
    expect(repo.insertCotejo).toHaveBeenCalledWith(client, expect.objectContaining({ nifEmisor: null }))
  })
})

describe('getQr', () => {
  it('cfg=null + sin importe_total → usa cliente_nif y total_display', async () => {
    repo.getConfig.mockResolvedValue(null)
    repo.findByNumSerie.mockResolvedValue({ num_serie: 'A/1', cliente_nif: 'C9', fecha_expedicion: 'f', total_display: '99,00' })
    await service.getQr(scope, 'A/1')
    expect(buildCotejoUrl).toHaveBeenCalledWith(expect.objectContaining({ nif: 'C9', importe: '99,00' }))
  })

  it('sin registro → null (no genera QR)', async () => {
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.findByNumSerie.mockResolvedValue(null)
    const out = await service.getQr(scope, '2027-A/404')
    expect(out).toBeNull()
    expect(generarQrDataUri).not.toHaveBeenCalled()
  })

  it('con registro → URL de cotejo recalculada + data URI', async () => {
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.findByNumSerie.mockResolvedValue({ num_serie: '2027-A/1', fecha_expedicion: 'f', importe_total: 121 })
    const out = await service.getQr(scope, '2027-A/1')
    expect(buildCotejoUrl).toHaveBeenCalled()
    expect(generarQrDataUri).toHaveBeenCalledWith('http://cotejo/url')
    expect(out).toEqual({ numSerie: '2027-A/1', url: 'http://cotejo/url', dataUri: 'data:image/png;base64,ZZ' })
  })

  it('sin numSerie → usa el último registro', async () => {
    repo.getConfig.mockResolvedValue({ nif_obligado: 'B1' })
    repo.latestRegistro.mockResolvedValue({ num_serie: 'LAST' })
    await service.getQr(scope, undefined)
    expect(repo.latestRegistro).toHaveBeenCalled()
    expect(repo.findByNumSerie).not.toHaveBeenCalled()
  })
})

describe('verificarCadena', () => {
  it('mapea filas a {numero, huella, huellaAnterior} y delega en verificarEnlace', async () => {
    repo.listRegistros.mockResolvedValue([
      { numero: 1, huella: 'H1', huella_anterior: null },
      { numero: 2, huella: 'H2', huella_anterior: 'H1' },
    ])
    const out = await service.verificarCadena(scope)
    expect(verificarEnlace).toHaveBeenCalledWith([
      { numero: 1, huella: 'H1', huellaAnterior: null },
      { numero: 2, huella: 'H2', huellaAnterior: 'H1' },
    ])
    expect(out).toEqual({ valida: true, rota: null })
  })
})

describe('getConfig / patchConfig', () => {
  it('getConfig sin row → defaults', async () => {
    repo.getConfig.mockResolvedValue(null)
    const out = await service.getConfig(scope)
    expect(out).toMatchObject({ tiempoEsperaEnvio: 60, maxRegistrosLote: 1000, reintentos: 3, dlqEnabled: true })
  })

  it('getConfig con row → camelCase mapeado', async () => {
    repo.getConfig.mockResolvedValue({
      tiempo_espera_envio: 30, max_registros_lote: 500, reintentos: 5, dlq_enabled: false,
      nif_obligado: 'B1', nombre_obligado: 'Obligado',
    })
    const out = await service.getConfig(scope)
    expect(out).toEqual({
      tiempoEsperaEnvio: 30, maxRegistrosLote: 500, reintentos: 5, dlqEnabled: false,
      nifObligado: 'B1', nombreObligado: 'Obligado',
    })
  })

  it('patchConfig → upsertConfig con scope + devuelve camelCase', async () => {
    repo.upsertConfig.mockResolvedValue({ tiempo_espera_envio: 10, max_registros_lote: 100, reintentos: 1, dlq_enabled: true })
    const out = await service.patchConfig(scope, { tiempoEsperaEnvio: 10 })
    expect(repo.upsertConfig).toHaveBeenCalledWith(client, 'aikikan', 't1', { tiempoEsperaEnvio: 10 })
    expect(out).toEqual({ tiempoEsperaEnvio: 10, maxRegistrosLote: 100, reintentos: 1, dlqEnabled: true })
  })
})

describe('validar', () => {
  it('usa el registro aportado', async () => {
    const reg = { numSerie: 'X', huella: 'H' }
    service.validar({ registro: reg })
    expect(validarRegistro).toHaveBeenCalledWith(reg)
  })

  it('sin registro → valida una muestra autoconsistente', async () => {
    service.validar({})
    expect(validarRegistro).toHaveBeenCalledWith(expect.objectContaining({ numSerie: expect.any(String), huella: expect.any(String) }))
  })
})

// ── lecturas list* (mapeo de filas → DTO) ─────────────────────────────

describe('listFacturas', () => {
  it('mapea registros a DTO de factura', async () => {
    repo.listRegistros.mockResolvedValue([{
      num_serie: 'S1', cliente_nombre: 'Ana', fecha_expedicion: 'F',
      total_display: '121,00', estado_remision: 'ok', huella: 'H1', huella_anterior: 'H0',
    }])
    const r = await service.listFacturas(scope)
    expect(r).toEqual([{ serie: 'S1', cliente: 'Ana', fecha: 'F', total: '121,00', estado: 'ok', huella: 'H1' }])
  })
})

describe('listRemisiones', () => {
  it('mapea label conocido + tone; limit 3', async () => {
    repo.listRegistros.mockResolvedValue([
      { num_serie: 'S1', cliente_nombre: 'Ana', estado_remision: 'ok' },
      { num_serie: 'S2', cliente_nombre: 'Bea', estado_remision: 'desconocido' },
    ])
    const r = await service.listRemisiones(scope)
    expect(repo.listRegistros).toHaveBeenCalledWith(client, { limit: 3 })
    expect(r[0].label).toBe('Aceptada')
    expect(r[1].label).toBe('desconocido') // fallback al propio estado
  })
})

describe('listCadena', () => {
  it('marca current el primero + mapea anterior', async () => {
    repo.listRegistros.mockResolvedValue([
      { numero: 2, num_serie: 'S2', huella: 'H2', huella_anterior: 'H1' },
      { numero: 1, num_serie: 'S1', huella: 'H1', huella_anterior: null },
    ])
    const r = await service.listCadena(scope)
    expect(r[0].current).toBe(true)
    expect(r[1].current).toBe(false)
    expect(r[1].anterior).toBeUndefined()
  })
})

describe('listEventos', () => {
  it('mapea eventos a DTO', async () => {
    repo.listEventos.mockResolvedValue([{ tag: 'ALTA', tone: 'ok', descripcion: 'd', ts_display: 'ahora' }])
    const r = await service.listEventos(scope)
    expect(r).toEqual([{ tag: 'ALTA', tone: 'ok', text: 'd', ts: 'ahora' }])
  })
})

describe('listClientes', () => {
  it('mapea clientes', async () => {
    repo.listClientes.mockResolvedValue([{ nombre: 'Ana', nif: 'X', facturas_mes: 3, estado: 'ok' }])
    const r = await service.listClientes(scope)
    expect(r).toEqual([{ nombre: 'Ana', nif: 'X', facturasMes: 3, estado: 'ok' }])
  })
})

describe('listLotes', () => {
  it('mapea lotes', async () => {
    repo.listLotes.mockResolvedValue([{ codigo: 'L1', info: 'i', label: 'l', tone: 't', pulse: true }])
    const r = await service.listLotes(scope)
    expect(r).toEqual([{ id: 'L1', info: 'i', label: 'l', tone: 't', pulse: true }])
  })
})

describe('listRepresentacion', () => {
  it('mapea representación', async () => {
    repo.listRepresentacion.mockResolvedValue([{
      nombre: 'Ana', nif: 'X', apoderamiento_doc: 'doc', apoderamiento_vigencia: 'v',
      repr_estado: 'vigente', repr_tone: 'ok',
    }])
    const r = await service.listRepresentacion(scope)
    expect(r).toEqual([{ representado: 'Ana', nif: 'X', doc: 'doc', vigencia: 'v', estado: 'vigente', tone: 'ok' }])
  })
})

describe('crearCliente', () => {
  it('inserta y mapea respuesta', async () => {
    repo.insertCliente.mockResolvedValue({ nombre: 'Ana', nif: 'X', facturas_mes: 0, estado: 'ok' })
    const r = await service.crearCliente(scope, { nombre: 'Ana', nif: 'X' })
    expect(repo.insertCliente).toHaveBeenCalledWith(client, expect.objectContaining({ nombre: 'Ana', appId: 'aikikan' }))
    expect(r).toEqual({ nombre: 'Ana', nif: 'X', facturasMes: 0, estado: 'ok' })
  })
})

describe('listCertificados', () => {
  it('mapea certificados', async () => {
    repo.listCertificados.mockResolvedValue([{ nombre: 'c', meta: 'm', estado: 'ok', tone: 't', icon_tone: 'it' }])
    const r = await service.listCertificados(scope)
    expect(r).toEqual([{ nombre: 'c', meta: 'm', estado: 'ok', tone: 't', iconTone: 'it' }])
  })
})

describe('listCotejos', () => {
  it('mapea cotejos con ref compuesta', async () => {
    repo.listCotejos.mockResolvedValue([{
      label: 'Verificada', tone: 'ok', resultado: 'verificada',
      nif_emisor: 'B1', num_serie: 'S1', ts_display: 'ahora',
    }])
    const r = await service.listCotejos(scope)
    expect(r[0].ref).toBe('B1 · S1')
  })
})
