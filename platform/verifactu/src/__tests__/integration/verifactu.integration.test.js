/**
 * Integration tests para platform/verifactu — requieren Postgres (5433).
 *
 * Cubre: migraciones (schema + 7 tablas + RLS forzada), endpoints públicos
 * (registros/cadena/eventos/clientes/config/cotejo/qr/validar), encadenamiento
 * real de huella, y AISLAMIENTO CROSS-TENANT (RLS: un tenant no ve datos de otro).
 *
 * Start: ./scripts/test-db-up.sh
 * Run:   pnpm --filter @apphub/platform-verifactu test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { AppError } from '@apphub/platform-sdk/errors'
import {
  serializerCompiler, validatorCompiler, hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod'
import { register, runMigrations } from '../../index.js'
import { createPool } from '@apphub/platform-sdk/db'

const APP_ID   = 'vf-itest'
const TENANT_A = '00000000-0000-0000-0000-00000000a001'
const TENANT_B = '00000000-0000-0000-0000-00000000b002'
const qs = (tenantId, extra = '') => `appId=${APP_ID}&tenantId=${tenantId}${extra}`

let app
let adminPool
let modulePool

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool  = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  modulePool = createPool(process.env.DATABASE_URL)
  await adminPool.query('SELECT 1')

  app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler((err, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err) || err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid' } })
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    }
    return reply.status(500).send({ error: { code: 'INTERNAL', message: err.message } })
  })
  await register({ app, db: modulePool, redis: { publish: () => Promise.resolve(1) } })
  await app.ready()
})

afterAll(async () => {
  // Limpia los datos del tenant de test.
  for (const t of ['registros', 'eventos', 'lotes', 'clientes', 'certificados', 'config', 'cotejos']) {
    await adminPool.query(`DELETE FROM platform_verifactu.${t} WHERE app_id = $1`, [APP_ID]).catch(() => {})
  }
  await app?.close()
  await adminPool?.end()
  await modulePool?.end()
})

const post = (path, payload) => app.inject({ method: 'POST', url: path, payload })
const patch = (path, payload) => app.inject({ method: 'PATCH', url: path, payload })
const get = (path) => app.inject({ method: 'GET', url: path })
const body = (res) => JSON.parse(res.body)

// ═══════════════════════════════════════════════════════════════════
describe('migraciones', () => {
  it('schema + 7 tablas existen', async () => {
    const { rows } = await adminPool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'platform_verifactu' ORDER BY tablename`,
    )
    const names = rows.map((r) => r.tablename)
    expect(names).toEqual(expect.arrayContaining([
      'registros', 'eventos', 'lotes', 'clientes', 'certificados', 'config', 'cotejos',
    ]))
  })

  it('RLS habilitada + forzada en todas las tablas', async () => {
    const { rows } = await adminPool.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'platform_verifactu')
          AND relkind = 'r' AND relname <> 'migrations'`,
    )
    for (const r of rows) {
      expect(r.relrowsecurity, r.relname).toBe(true)
      expect(r.relforcerowsecurity, r.relname).toBe(true)
    }
  })

  it('re-correr migraciones es idempotente', async () => {
    await expect(runMigrations(process.env.MIGRATION_DATABASE_URL)).resolves.toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════
describe('registros + huella encadenada', () => {
  it('POST crea registro con huella SHA-256 real', async () => {
    const res = await post('/v1/verifactu/registros', {
      appId: APP_ID, tenantId: TENANT_A, numSerie: 'VF-A/0001',
      clienteNombre: 'Cliente A', clienteNif: 'A1', fechaExpedicion: '31-05-2026',
      importeTotal: 100, cuotaTotal: 21, totalDisplay: '100,00 €',
    })
    expect(res.statusCode).toBe(201)
    expect(body(res).huella).toMatch(/^[0-9A-F]{64}$/)
  })

  it('el segundo registro encadena con la huella del primero', async () => {
    await post('/v1/verifactu/registros', {
      appId: APP_ID, tenantId: TENANT_A, numSerie: 'VF-A/0002',
      fechaExpedicion: '31-05-2026', importeTotal: 50, totalDisplay: '50,00 €',
    })
    const cadena = body(await get(`/v1/verifactu/cadena?${qs(TENANT_A)}`))
    // cadena viene desc por numero; el más reciente referencia al anterior
    expect(cadena[0].anterior).toBe(cadena[1].huella)
  })

  it('GET /cadena/verificar → ok para la cadena recién creada', async () => {
    const r = body(await get(`/v1/verifactu/cadena/verificar?${qs(TENANT_A)}`))
    expect(r.ok).toBe(true)
    expect(r.rotos).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════
describe('RLS · aislamiento cross-tenant', () => {
  it('registro creado por A no es visible para B', async () => {
    await post('/v1/verifactu/registros', {
      appId: APP_ID, tenantId: TENANT_A, numSerie: 'VF-A/SECRET',
      fechaExpedicion: '31-05-2026', importeTotal: 9, totalDisplay: '9 €',
    })
    const series = (s) => s.map((r) => r.serie)
    expect(series(body(await get(`/v1/verifactu/registros?${qs(TENANT_A)}`)))).toContain('VF-A/SECRET')
    expect(series(body(await get(`/v1/verifactu/registros?${qs(TENANT_B)}`)))).not.toContain('VF-A/SECRET')
  })

  it('cliente de A no es visible para B', async () => {
    await post('/v1/verifactu/clientes', { appId: APP_ID, tenantId: TENANT_A, nombre: 'Solo-A', nif: 'NIFA' })
    const nifs = (s) => s.map((c) => c.nif)
    expect(nifs(body(await get(`/v1/verifactu/clientes?${qs(TENANT_A)}`)))).toContain('NIFA')
    expect(nifs(body(await get(`/v1/verifactu/clientes?${qs(TENANT_B)}`)))).not.toContain('NIFA')
  })

  it('config de A (PATCH) no afecta a B', async () => {
    await patch('/v1/verifactu/config', { appId: APP_ID, tenantId: TENANT_A, dlqEnabled: false, reintentos: 9 })
    expect(body(await get(`/v1/verifactu/config?${qs(TENANT_A)}`)).reintentos).toBe(9)
    // B nunca configuró → defaults
    expect(body(await get(`/v1/verifactu/config?${qs(TENANT_B)}`)).reintentos).toBe(3)
  })

  it('cotejo: serie de A no consta para B', async () => {
    await post('/v1/verifactu/registros', {
      appId: APP_ID, tenantId: TENANT_A, numSerie: 'VF-A/COTEJO',
      fechaExpedicion: '31-05-2026', importeTotal: 1, totalDisplay: '1 €',
    })
    expect(body(await post('/v1/verifactu/cotejo', { appId: APP_ID, tenantId: TENANT_A, numSerie: 'VF-A/COTEJO' })).verificada).toBe(true)
    expect(body(await post('/v1/verifactu/cotejo', { appId: APP_ID, tenantId: TENANT_B, numSerie: 'VF-A/COTEJO' })).verificada).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════
describe('eventos del SIF', () => {
  it('POST /eventos genera huella encadenada y GET lo lista', async () => {
    const e1 = body(await post('/v1/verifactu/eventos', { appId: APP_ID, tenantId: TENANT_A, tipoEvento: 'ARRANQUE' }))
    const e2 = body(await post('/v1/verifactu/eventos', { appId: APP_ID, tenantId: TENANT_A, tipoEvento: 'EXPORTACION' }))
    expect(e1.huella).toMatch(/^[0-9A-F]{64}$/)
    expect(e2.huella).not.toBe(e1.huella)
    const lista = body(await get(`/v1/verifactu/eventos?${qs(TENANT_A)}`))
    expect(lista.map((e) => e.tag)).toEqual(expect.arrayContaining(['ARRANQUE', 'EXPORTACION']))
  })

  it('tipoEvento fuera del catálogo → 422', async () => {
    const res = await post('/v1/verifactu/eventos', { appId: APP_ID, tenantId: TENANT_A, tipoEvento: 'INVENTADO' })
    expect(res.statusCode).toBe(422)
  })
})

// ═══════════════════════════════════════════════════════════════════
describe('QR / validar / health', () => {
  it('GET /qr devuelve url de cotejo + data URI', async () => {
    const r = body(await get(`/v1/verifactu/qr?${qs(TENANT_A)}`))
    expect(r.url).toContain('ValidarQR')
    expect(r.dataUri.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('POST /validar → checks reales', async () => {
    const r = body(await post('/v1/verifactu/validar', {}))
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.checks)).toBe(true)
  })

  it('GET /api/verifactu/health → 200', async () => {
    const res = await get('/api/verifactu/health')
    expect(res.statusCode).toBe(200)
    expect(body(res)).toMatchObject({ status: 'ok', module: 'verifactu' })
  })
})
