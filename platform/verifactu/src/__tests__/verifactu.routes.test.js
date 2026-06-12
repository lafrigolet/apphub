// verifactu.routes — wiring HTTP → service CON autenticación (uso §18).
// El scope (appId, tenantId) sale de req.identity (JWT), no de query/body.
// appGuard se simula con un onRequest que decora req.identity desde la cabecera
// `x-identity` (o un staff por defecto). Contrato:
//   - cada lectura/escritura delega en el service con el scope del token.
//   - las mutaciones exigen rol staff/super_admin (requireRole real).
//   - sin identidad → 401; rol insuficiente → 403.
//   - POST /registros y /eventos → 201; GET /qr → 404 si el service da null.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/verifactu.service.js', () => ({
  listFacturas: vi.fn(), listRemisiones: vi.fn(), listCadena: vi.fn(), verificarCadena: vi.fn(),
  listEventos: vi.fn(), crearEvento: vi.fn(), getQr: vi.fn(), crearRegistro: vi.fn(),
  listClientes: vi.fn(), listLotes: vi.fn(), listRepresentacion: vi.fn(), crearCliente: vi.fn(),
  getConfig: vi.fn(), patchConfig: vi.fn(),
  listCotejos: vi.fn(), cotejar: vi.fn(), validar: vi.fn(),
  recalcularCadenaCompleta: vi.fn(), listSeries: vi.fn(), crearSerie: vi.fn(),
  cerrarSerie: vi.fn(), exportar: vi.fn(),
}))

vi.mock('../services/certificados.service.js', () => ({
  listCertificados: vi.fn(), getCertificado: vi.fn(), subirCertificado: vi.fn(),
  renovarCertificado: vi.fn(), eliminarCertificado: vi.fn(),
}))

vi.mock('../services/remision.service.js', () => ({
  drenar: vi.fn(), estadoCola: vi.fn(), remitirUno: vi.fn(), firmarRegistro: vi.fn(),
  dryRun: vi.fn(), reintentarDlq: vi.fn(), loteDetalle: vi.fn(),
}))

import { publicRoutes } from '../routes/verifactu.routes.js'
import * as service from '../services/verifactu.service.js'
import * as certs from '../services/certificados.service.js'
import * as remision from '../services/remision.service.js'

const APP = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'
const STAFF = { appId: APP, tenantId: TENANT, subTenantId: null, role: 'staff', userId: 'u1' }

async function buildApp() {
  const app = Fastify({ logger: false, ignoreTrailingSlash: true })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: r.error }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  app.setSerializerCompiler(() => (d) => JSON.stringify(d))
  app.decorateRequest('identity', null)
  // Simula appGuard: req.identity desde la cabecera x-identity ('none' → sin auth).
  app.addHook('onRequest', async (req) => {
    const h = req.headers['x-identity']
    req.identity = h === 'none' ? null : (h ? JSON.parse(h) : STAFF)
  })
  await app.register(async (scope) => { await publicRoutes(scope) }, { prefix: '/v1/verifactu' })
  app.setErrorHandler((err, req, reply) => {
    if (err.validation || err.name === 'ZodError') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

const asId = (id) => ({ 'x-identity': JSON.stringify(id) })

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('GET lecturas — scope desde el token', () => {
  it('GET /registros → service.listFacturas(scope del token)', async () => {
    service.listFacturas.mockResolvedValue([{ serie: 'A/1' }])
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/registros' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ serie: 'A/1' }])
    expect(service.listFacturas).toHaveBeenCalledWith({ appId: APP, tenantId: TENANT, subTenantId: null })
  })

  it('subTenantId del token se propaga al scope', async () => {
    service.listFacturas.mockResolvedValue([])
    const sub = '33333333-3333-3333-3333-333333333333'
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/registros', headers: asId({ ...STAFF, subTenantId: sub }) })
    expect(res.statusCode).toBe(200)
    expect(service.listFacturas).toHaveBeenCalledWith({ appId: APP, tenantId: TENANT, subTenantId: sub })
  })

  it('staff puede impersonar otro tenant por query (?tenantId=)', async () => {
    service.listFacturas.mockResolvedValue([])
    const other = '44444444-4444-4444-4444-444444444444'
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/registros?tenantId=${other}` })
    expect(res.statusCode).toBe(200)
    expect(service.listFacturas).toHaveBeenCalledWith(expect.objectContaining({ tenantId: other }))
  })

  it('un rol NO-staff ignora la impersonación por query (usa su propio tenant)', async () => {
    service.listFacturas.mockResolvedValue([])
    const other = '44444444-4444-4444-4444-444444444444'
    const user = { appId: APP, tenantId: TENANT, subTenantId: null, role: 'user', userId: 'u2' }
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/registros?tenantId=${other}`, headers: asId(user) })
    expect(res.statusCode).toBe(200)
    expect(service.listFacturas).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it.each([
    ['/remisiones', 'listRemisiones'],
    ['/cadena', 'listCadena'],
    ['/eventos', 'listEventos'],
    ['/clientes', 'listClientes'],
    ['/lotes', 'listLotes'],
    ['/representacion', 'listRepresentacion'],
    ['/config', 'getConfig'],
    ['/cotejos', 'listCotejos'],
  ])('GET %s → service.%s(scope)', async (path, fn) => {
    service[fn].mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu${path}` })
    expect(res.statusCode).toBe(200)
    expect(service[fn]).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it('GET /certificados → certs.listCertificados(scope)', async () => {
    certs.listCertificados.mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/certificados' })
    expect(res.statusCode).toBe(200)
    expect(certs.listCertificados).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it('GET /cola → remision.estadoCola(scope)', async () => {
    remision.estadoCola.mockResolvedValue({ resumen: {}, cola: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/cola' })
    expect(res.statusCode).toBe(200)
    expect(remision.estadoCola).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it('GET /cadena/verificar → service.verificarCadena', async () => {
    service.verificarCadena.mockResolvedValue({ valida: true })
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/cadena/verificar' })
    expect(res.statusCode).toBe(200)
    expect(service.verificarCadena).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it('GET /cadena/recalcular → service.recalcularCadenaCompleta', async () => {
    service.recalcularCadenaCompleta.mockResolvedValue({ ok: true, verificados: 3 })
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/cadena/recalcular' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, verificados: 3 })
  })

  it('GET /series → service.listSeries', async () => {
    service.listSeries.mockResolvedValue([{ codigo: 'VENTAS' }])
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/series' })
    expect(res.statusCode).toBe(200)
    expect(service.listSeries).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })
})

describe('autenticación / autorización', () => {
  it('sin identidad (token ausente) → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/registros', headers: { 'x-identity': 'none' } })
    expect(res.statusCode).toBe(401)
    expect(service.listFacturas).not.toHaveBeenCalled()
  })

  it('mutación con rol insuficiente (user) → 403', async () => {
    const user = { appId: APP, tenantId: TENANT, subTenantId: null, role: 'user', userId: 'u2' }
    const res = await app.inject({ method: 'POST', url: '/v1/verifactu/registros', headers: { ...asId(user), 'Content-Type': 'application/json' }, payload: { importeTotal: 10 } })
    expect(res.statusCode).toBe(403)
    expect(service.crearRegistro).not.toHaveBeenCalled()
  })

  it('mutación sin identidad → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/verifactu/remitir', headers: { 'x-identity': 'none', 'Content-Type': 'application/json' }, payload: {} })
    expect(res.statusCode).toBe(401)
    expect(remision.drenar).not.toHaveBeenCalled()
  })
})

describe('POST mutaciones (staff)', () => {
  it('POST /registros → 201 + service.crearRegistro(scope, body)', async () => {
    service.crearRegistro.mockResolvedValue({ serie: 'A/7', huella: 'H' })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/registros',
      headers: { 'Content-Type': 'application/json' },
      payload: { importeTotal: 121, cuotaTotal: 21 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.crearRegistro).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
      expect.objectContaining({ importeTotal: 121 }),
    )
  })

  it('POST /eventos → 201 + service.crearEvento', async () => {
    service.crearEvento.mockResolvedValue({ tag: 'ARRANQUE' })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/eventos',
      headers: { 'Content-Type': 'application/json' },
      payload: { tipoEvento: 'ARRANQUE', descripcion: 'x' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.crearEvento).toHaveBeenCalled()
  })

  it('POST /clientes → 201 + service.crearCliente(scope, body)', async () => {
    service.crearCliente.mockResolvedValue({ nombre: 'Ana', nif: 'X' })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/clientes',
      headers: { 'Content-Type': 'application/json' },
      payload: { nombre: 'Ana', nif: 'X' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.crearCliente).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
      expect.objectContaining({ nombre: 'Ana', nif: 'X' }),
    )
  })

  it('POST /cotejo (cualquier autenticado) → service.cotejar(scope, body)', async () => {
    service.cotejar.mockResolvedValue({ verificada: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/cotejo',
      headers: { 'Content-Type': 'application/json' },
      payload: { numSerie: 'A/1' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.cotejar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), expect.objectContaining({ numSerie: 'A/1' }))
  })

  it('PATCH /config → service.patchConfig(scope, body)', async () => {
    service.patchConfig.mockResolvedValue({ reintentos: 5 })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/verifactu/config',
      headers: { 'Content-Type': 'application/json' },
      payload: { reintentos: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.patchConfig).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), expect.objectContaining({ reintentos: 5 }))
  })

  it('POST /remitir → remision.drenar(scope)', async () => {
    remision.drenar.mockResolvedValue({ remitidos: 2, lote: 'LOTE-0001' })
    const res = await app.inject({ method: 'POST', url: '/v1/verifactu/remitir', headers: { 'Content-Type': 'application/json' }, payload: {} })
    expect(res.statusCode).toBe(200)
    expect(remision.drenar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it('POST /registros/:numSerie/remitir → remision.remitirUno(scope, numSerie)', async () => {
    remision.remitirUno.mockResolvedValue({ remitidos: 1 })
    const res = await app.inject({ method: 'POST', url: '/v1/verifactu/registros/A%2F1/remitir', headers: { 'Content-Type': 'application/json' }, payload: {} })
    expect(res.statusCode).toBe(200)
    expect(remision.remitirUno).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), 'A/1')
  })

  it('POST /certificados → 201 + certs.subirCertificado', async () => {
    certs.subirCertificado.mockResolvedValue({ id: 'c1', cn: 'ACME' })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/certificados',
      headers: { 'Content-Type': 'application/json' },
      payload: { pkcs12Base64: 'AAAA', passphrase: 'pw' },
    })
    expect(res.statusCode).toBe(201)
    expect(certs.subirCertificado).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), expect.objectContaining({ pkcs12Base64: 'AAAA' }))
  })

  it('DELETE /certificados/:id → certs.eliminarCertificado', async () => {
    certs.eliminarCertificado.mockResolvedValue({ id: 'c1', eliminado: true })
    const res = await app.inject({ method: 'DELETE', url: '/v1/verifactu/certificados/11111111-1111-4111-8111-111111111111' })
    expect(res.statusCode).toBe(200)
    expect(certs.eliminarCertificado).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), '11111111-1111-4111-8111-111111111111')
  })

  it('POST /series → 201 + service.crearSerie(scope, body)', async () => {
    service.crearSerie.mockResolvedValue({ codigo: 'VENTAS', activa: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/series',
      headers: { 'Content-Type': 'application/json' },
      payload: { codigo: 'VENTAS', ejercicio: 2027 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.crearSerie).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
      expect.objectContaining({ codigo: 'VENTAS', ejercicio: 2027 }),
    )
  })

  it('POST /series/:codigo/cerrar → service.cerrarSerie(scope, codigo)', async () => {
    service.cerrarSerie.mockResolvedValue({ codigo: 'VENTAS', activa: false })
    const res = await app.inject({ method: 'POST', url: '/v1/verifactu/series/VENTAS/cerrar', headers: { 'Content-Type': 'application/json' }, payload: {} })
    expect(res.statusCode).toBe(200)
    expect(service.cerrarSerie).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), 'VENTAS')
  })

  it('GET /exportar (staff) → service.exportar', async () => {
    service.exportar.mockResolvedValue({ meta: {}, registros: [], eventos: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/exportar' })
    expect(res.statusCode).toBe(200)
    expect(service.exportar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it('POST /validar (cualquier autenticado) → service.validar(body crudo)', async () => {
    service.validar.mockReturnValue({ ok: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/validar',
      headers: { 'Content-Type': 'application/json' },
      payload: { registro: { numSerie: 'A/1' } },
    })
    expect(res.statusCode).toBe(200)
    expect(service.validar).toHaveBeenCalledWith({ registro: { numSerie: 'A/1' } })
  })
})

describe('GET /qr', () => {
  it('service devuelve null → 404', async () => {
    service.getQr.mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/qr' })
    expect(res.statusCode).toBe(404)
  })

  it('service devuelve registro → 200 con dataUri', async () => {
    service.getQr.mockResolvedValue({ numSerie: 'A/1', url: 'u', dataUri: 'data:...' })
    const res = await app.inject({ method: 'GET', url: '/v1/verifactu/qr?numSerie=A/1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().dataUri).toBe('data:...')
    expect(service.getQr).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), 'A/1')
  })
})
