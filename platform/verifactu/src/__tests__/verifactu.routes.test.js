// verifactu.routes — wiring HTTP → service. En V1 TODAS las rutas son
// `public` (el portal aún no tiene login); el scope (appId, tenantId) viaja
// en query (GET) o body (POST/PATCH) y se valida con zod (tenantId uuid).
// Contrato:
//   - cada ruta delega en el service con el scope parseado.
//   - scope inválido (sin tenantId / uuid malo) → error de validación.
//   - POST /registros y /eventos → 201.
//   - GET /qr → 404 cuando el service devuelve null.
//   - POST /validar pasa el body crudo al service.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../services/verifactu.service.js', () => ({
  listFacturas: vi.fn(), listRemisiones: vi.fn(), listCadena: vi.fn(), verificarCadena: vi.fn(),
  listEventos: vi.fn(), crearEvento: vi.fn(), getQr: vi.fn(), crearRegistro: vi.fn(),
  listClientes: vi.fn(), listLotes: vi.fn(), listRepresentacion: vi.fn(), crearCliente: vi.fn(),
  listCertificados: vi.fn(), getConfig: vi.fn(), patchConfig: vi.fn(),
  listCotejos: vi.fn(), cotejar: vi.fn(), validar: vi.fn(),
}))

import { publicRoutes } from '../routes/verifactu.routes.js'
import * as service from '../services/verifactu.service.js'

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
  await app.register(async (scope) => { await publicRoutes(scope) }, { prefix: '/v1/verifactu' })
  app.setErrorHandler((err, req, reply) => {
    if (err.validation || err.name === 'ZodError') return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

const APP = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'
const qs = `appId=${APP}&tenantId=${TENANT}`

let app
beforeEach(async () => { vi.clearAllMocks(); app = await buildApp() })
afterEach(async () => { await app.close() })

describe('GET lecturas — scope desde query', () => {
  it('GET /registros → service.listFacturas(scope) sin Authorization', async () => {
    service.listFacturas.mockResolvedValue([{ serie: 'A/1' }])
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/registros?${qs}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ serie: 'A/1' }])
    expect(service.listFacturas).toHaveBeenCalledWith({ appId: APP, tenantId: TENANT, subTenantId: null })
  })

  it('GET con subTenantId → scope.subTenantId presente (rama no-null)', async () => {
    service.listFacturas.mockResolvedValue([])
    const sub = '33333333-3333-3333-3333-333333333333'
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/registros?${qs}&subTenantId=${sub}` })
    expect(res.statusCode).toBe(200)
    expect(service.listFacturas).toHaveBeenCalledWith({ appId: APP, tenantId: TENANT, subTenantId: sub })
  })

  it.each([
    ['/remisiones', 'listRemisiones'],
    ['/cadena', 'listCadena'],
    ['/eventos', 'listEventos'],
    ['/clientes', 'listClientes'],
    ['/lotes', 'listLotes'],
    ['/representacion', 'listRepresentacion'],
    ['/certificados', 'listCertificados'],
    ['/config', 'getConfig'],
    ['/cotejos', 'listCotejos'],
  ])('GET %s → service.%s(scope)', async (path, fn) => {
    service[fn].mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu${path}?${qs}` })
    expect(res.statusCode).toBe(200)
    expect(service[fn]).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it('GET /cadena/verificar → service.verificarCadena', async () => {
    service.verificarCadena.mockResolvedValue({ valida: true })
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/cadena/verificar?${qs}` })
    expect(res.statusCode).toBe(200)
    expect(service.verificarCadena).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }))
  })

  it('scope inválido (sin tenantId) → 422, no llama al service', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/registros?appId=${APP}` })
    expect([400, 422]).toContain(res.statusCode)
    expect(service.listFacturas).not.toHaveBeenCalled()
  })

  it('tenantId no-uuid → 422', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/registros?appId=${APP}&tenantId=not-a-uuid` })
    expect([400, 422]).toContain(res.statusCode)
  })
})

describe('POST mutaciones', () => {
  it('POST /registros → 201 + service.crearRegistro(scope, body)', async () => {
    service.crearRegistro.mockResolvedValue({ serie: 'A/7', huella: 'H' })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/registros',
      headers: { 'Content-Type': 'application/json' },
      payload: { appId: APP, tenantId: TENANT, importeTotal: 121, cuotaTotal: 21 },
    })
    expect(res.statusCode).toBe(201)
    expect(service.crearRegistro).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
      expect.objectContaining({ importeTotal: 121 }),
    )
  })

  it('POST /eventos → 201 + service.crearEvento (tipoEvento del catálogo)', async () => {
    service.crearEvento.mockResolvedValue({ tag: 'ALTA' })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/eventos',
      headers: { 'Content-Type': 'application/json' },
      payload: { appId: APP, tenantId: TENANT, tipoEvento: 'ARRANQUE', descripcion: 'x' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.crearEvento).toHaveBeenCalled()
  })

  it('POST /clientes → 201 + service.crearCliente(scope, body)', async () => {
    service.crearCliente.mockResolvedValue({ nombre: 'Ana', nif: 'X' })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/clientes',
      headers: { 'Content-Type': 'application/json' },
      payload: { appId: APP, tenantId: TENANT, nombre: 'Ana', nif: 'X' },
    })
    expect(res.statusCode).toBe(201)
    expect(service.crearCliente).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
      expect.objectContaining({ nombre: 'Ana', nif: 'X' }),
    )
  })

  it('POST /cotejo → service.cotejar(scope, body)', async () => {
    service.cotejar.mockResolvedValue({ verificada: true })
    const res = await app.inject({
      method: 'POST', url: '/v1/verifactu/cotejo',
      headers: { 'Content-Type': 'application/json' },
      payload: { appId: APP, tenantId: TENANT, numSerie: 'A/1' },
    })
    expect(res.statusCode).toBe(200)
    expect(service.cotejar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), expect.objectContaining({ numSerie: 'A/1' }))
  })

  it('PATCH /config → service.patchConfig(scope, body)', async () => {
    service.patchConfig.mockResolvedValue({ reintentos: 5 })
    const res = await app.inject({
      method: 'PATCH', url: '/v1/verifactu/config',
      headers: { 'Content-Type': 'application/json' },
      payload: { appId: APP, tenantId: TENANT, reintentos: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect(service.patchConfig).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), expect.objectContaining({ reintentos: 5 }))
  })

  it('POST /validar → service.validar(body crudo)', async () => {
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
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/qr?${qs}` })
    expect(res.statusCode).toBe(404)
  })

  it('service devuelve registro → 200 con dataUri', async () => {
    service.getQr.mockResolvedValue({ numSerie: 'A/1', url: 'u', dataUri: 'data:...' })
    const res = await app.inject({ method: 'GET', url: `/v1/verifactu/qr?${qs}&numSerie=A/1` })
    expect(res.statusCode).toBe(200)
    expect(res.json().dataUri).toBe('data:...')
    expect(service.getQr).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), 'A/1')
  })
})

// Las ramas `req.query ?? {}` / `req.body ?? {}` (vía el helper `scope` y los
// `.parse(req.body ?? {})`) son inalcanzables por HTTP: fastify siempre provee
// query/body. Se invocan los handlers directamente con query/body undefined
// para cubrir el lado falsy del `??`. Como falta el scope obligatorio
// (appId/tenantId), la validación zod lanza → `.rejects`.
describe('defaults defensivos (?? {}) — handlers directos', () => {
  function captureRoutes() {
    const routes = []
    const rec = (m) => (p, o, h) => routes.push({ m, p, h: h ?? o })
    return publicRoutes({
      get: rec('get'), post: rec('post'), patch: rec('patch'),
      put: rec('put'), delete: rec('delete'), addHook: () => {},
    }).then(() => routes)
  }

  let routes
  beforeEach(async () => { routes = await captureRoutes() })

  const reply = () => ({ code: vi.fn(), send: vi.fn() })

  it('GET handlers con req.query undefined → scope({} ) → zod lanza (falta tenantId)', async () => {
    const gets = routes.filter((r) => r.m === 'get')
    for (const r of gets) {
      await expect(r.h({}, reply())).rejects.toBeTruthy()
    }
  })

  it('POST/PATCH handlers con req.body undefined → parse({}) → zod lanza', async () => {
    const muts = routes.filter((r) => r.m === 'post' && r.p !== '/validar')
      .concat(routes.filter((r) => r.m === 'patch'))
    for (const r of muts) {
      await expect(r.h({}, reply())).rejects.toBeTruthy()
    }
  })

  it('POST /validar con req.body undefined → service.validar({})', async () => {
    service.validar.mockReturnValue({ ok: true })
    const v = routes.find((r) => r.m === 'post' && r.p === '/validar')
    await v.h({}, reply())
    expect(service.validar).toHaveBeenCalledWith({})
  })
})
