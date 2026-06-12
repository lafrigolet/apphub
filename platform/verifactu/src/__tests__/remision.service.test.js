import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn({ query: vi.fn() })),
  pool: {}, configurePool: vi.fn(),
}))
vi.mock('../lib/remision.js', () => ({ remitir: vi.fn() }))
vi.mock('../repositories/verifactu.repository.js', () => ({
  getConfig: vi.fn(async () => ({ reintentos: 3, max_registros_lote: 1000, nif_obligado: 'B12345678', nombre_obligado: 'ACME SL' })),
  listRegistrosParaRehash: vi.fn(async () => []),
}))
vi.mock('../repositories/remision.repository.js', () => ({
  encolarPendientes: vi.fn(async () => 0),
  reclamarVencidos: vi.fn(),
  registrosCanonicos: vi.fn(),
  registroCanonicoPorNumSerie: vi.fn(),
  marcarResultado: vi.fn(async () => ({ id: 'q1', estado: 'ok' })),
  marcarErrorTransporte: vi.fn(),
  resumenCola: vi.fn(), listCola: vi.fn(), reintentarDlq: vi.fn(),
  insertLote: vi.fn(async () => ({ codigo: 'LOTE-0001' })),
  loteDetalle: vi.fn(), siguienteCodigoLote: vi.fn(async () => 'LOTE-0001'),
}))
vi.mock('../repositories/certificados.repository.js', () => ({ getCertificadoActivoMaterial: vi.fn() }))

import * as remision from '../services/remision.service.js'
import { remitir } from '../lib/remision.js'
import * as remRepo from '../repositories/remision.repository.js'
import * as certRepo from '../repositories/certificados.repository.js'

const scope = { appId: 'tpv', tenantId: 't', subTenantId: null }
const claimed = [{ id: 'q1', registro_id: 'r1', num_serie: 'A/1', intentos: 0, max_intentos: 3, entorno: 'test' }]
const canon = [{ id: 'r1', num_serie: 'A/1', tipo: 'alta', tipo_factura: 'F1', id_emisor: 'B12345678',
  fecha_expedicion: '01-01-2027', importe_total: '121.00', cuota_total: '21.00',
  gen_registro: '2027-01-01T10:00:00+01:00', huella: 'HUELLA1', huella_anterior: null }]

beforeEach(() => vi.clearAllMocks())

describe('remision.service — drenar', () => {
  it('cola vacía → remitidos 0 sin tocar la red', async () => {
    remRepo.reclamarVencidos.mockResolvedValue([])
    const r = await remision.drenar(scope)
    expect(r).toEqual({ remitidos: 0 })
    expect(remitir).not.toHaveBeenCalled()
  })

  it('respuesta Correcto → marca ok + crea lote', async () => {
    remRepo.reclamarVencidos.mockResolvedValue(claimed)
    remRepo.registrosCanonicos.mockResolvedValue(canon)
    certRepo.getCertificadoActivoMaterial.mockResolvedValue({ pkcs12: Buffer.from('p12'), passphrase: 'pw' })
    remitir.mockResolvedValue({ respuesta: { estadoEnvio: 'Correcto', csv: 'CSV-ENVIO',
      lineas: [{ numSerie: 'A/1', estado: 'Correcto', csv: 'CSV-A1' }] } })

    const r = await remision.drenar(scope)
    expect(r).toMatchObject({ remitidos: 1, ok: 1, lote: 'LOTE-0001' })
    expect(remitir).toHaveBeenCalledOnce()
    // el envelope se construyó con el PKCS#12 del cert activo
    expect(remitir.mock.calls[0][0]).toMatchObject({ passphrase: 'pw', entorno: 'test' })
    expect(remRepo.marcarResultado).toHaveBeenCalledWith(expect.anything(), 'q1',
      expect.objectContaining({ estado: 'ok', csv: 'CSV-A1', loteCodigo: 'LOTE-0001' }))
    expect(remRepo.insertLote).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ codigo: 'LOTE-0001', numRegistros: 1, estadoEnvio: 'Correcto' }))
  })

  it('línea Incorrecto → marca err', async () => {
    remRepo.reclamarVencidos.mockResolvedValue(claimed)
    remRepo.registrosCanonicos.mockResolvedValue(canon)
    certRepo.getCertificadoActivoMaterial.mockResolvedValue({ pkcs12: Buffer.from('p12'), passphrase: 'pw' })
    remitir.mockResolvedValue({ respuesta: { estadoEnvio: 'ParcialmenteCorrecto',
      lineas: [{ numSerie: 'A/1', estado: 'Incorrecto', codigoError: '4102', descripcion: 'NIF inválido' }] } })

    const r = await remision.drenar(scope)
    expect(r).toMatchObject({ remitidos: 1, err: 1 })
    expect(remRepo.marcarResultado).toHaveBeenCalledWith(expect.anything(), 'q1',
      expect.objectContaining({ estado: 'err', codigoError: '4102' }))
  })

  it('sin certificado activo → SIN_CERTIFICADO y filas devueltas a err', async () => {
    remRepo.reclamarVencidos.mockResolvedValue(claimed)
    remRepo.registrosCanonicos.mockResolvedValue(canon)
    certRepo.getCertificadoActivoMaterial.mockResolvedValue(null)
    await expect(remision.drenar(scope)).rejects.toMatchObject({ code: 'SIN_CERTIFICADO' })
    expect(remRepo.marcarErrorTransporte).toHaveBeenCalledWith(expect.anything(), ['q1'], expect.stringMatching(/certificado/))
    expect(remitir).not.toHaveBeenCalled()
  })

  it('fallo de transporte → marca error y no crea lote', async () => {
    remRepo.reclamarVencidos.mockResolvedValue(claimed)
    remRepo.registrosCanonicos.mockResolvedValue(canon)
    certRepo.getCertificadoActivoMaterial.mockResolvedValue({ pkcs12: Buffer.from('p12'), passphrase: 'pw' })
    remitir.mockRejectedValue(new Error('ECONNRESET'))

    const r = await remision.drenar(scope)
    expect(r).toMatchObject({ remitidos: 0, error: 'ECONNRESET' })
    expect(remRepo.marcarErrorTransporte).toHaveBeenCalledWith(expect.anything(), ['q1'], 'ECONNRESET')
    expect(remRepo.insertLote).not.toHaveBeenCalled()
  })
})
