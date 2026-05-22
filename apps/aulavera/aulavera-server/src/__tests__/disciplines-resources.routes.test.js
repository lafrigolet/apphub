// disciplines.routes + resources.routes — wiring HTTP → service público.
// Ambos endpoints son `public: true` (no requieren JWT); el tenantId viene
// del query param (?tenantId=) o de un JWT Bearer (opcional).
//
// Contrato:
//   GET /v1/aulavera/disciplines:
//     - Sin tenantId → ValidationError (422).
//     - tenantId vía query → service.listDisciplines(tenantId).
//   GET /v1/aulavera/resources:
//     - Sin tenantId → 422.
//     - type ∈ {video, document, guide} o ausente; otro → zod error.
//     - Pasa { type } al service.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
    EXPECTED_APP_ID: 'aulavera',
  },
}))
vi.mock('../services/disciplines.service.js')
vi.mock('../services/resources.service.js')

import * as disciplinesService from '../services/disciplines.service.js'
import * as resourcesService from '../services/resources.service.js'
import { disciplinesRoutes } from '../routes/disciplines.routes.js'
import { resourcesRoutes } from '../routes/resources.routes.js'

const TENANT = '22222222-2222-2222-2222-222222222222'

async function buildApp() {
  const app = Fastify({ logger: false })
  // Errors → status code
  app.setErrorHandler((err, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({ error: { code: err.code, message: err.message } })
  })
  await app.register(disciplinesRoutes)
  await app.register(resourcesRoutes)
  return app
}

beforeEach(() => vi.clearAllMocks())

// ── disciplines ─────────────────────────────────────────────────────

describe('GET /v1/aulavera/disciplines', () => {
  it('sin tenantId → 422 (tenantFromRequest lanza ValidationError)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/aulavera/disciplines' })
    expect(res.statusCode).toBe(422)
  })

  it('tenantId vía query → llama service.listDisciplines(tenantId)', async () => {
    disciplinesService.listDisciplines.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/v1/aulavera/disciplines?tenantId=${TENANT}`,
    })
    expect(res.statusCode).toBe(200)
    expect(disciplinesService.listDisciplines).toHaveBeenCalledWith(TENANT)
    expect(res.json()).toHaveLength(2)
  })

  it('service lanza ValidationError → 422 propagado', async () => {
    disciplinesService.listDisciplines.mockRejectedValue(
      Object.assign(new Error('tenantId requerido'), { statusCode: 422 }),
    )
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/v1/aulavera/disciplines?tenantId=${TENANT}`,
    })
    expect(res.statusCode).toBe(422)
  })
})

// ── resources ───────────────────────────────────────────────────────

describe('GET /v1/aulavera/resources', () => {
  it('sin tenantId → 422', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/aulavera/resources' })
    expect(res.statusCode).toBe(422)
  })

  it('tenantId + sin type → llama listResources con { type: undefined }', async () => {
    resourcesService.listResources.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/v1/aulavera/resources?tenantId=${TENANT}`,
    })
    expect(res.statusCode).toBe(200)
    expect(resourcesService.listResources).toHaveBeenCalledWith(TENANT, { type: undefined })
  })

  it.each([['video'], ['document'], ['guide']])(
    'type="%s" → pasa al service',
    async (type) => {
      resourcesService.listResources.mockResolvedValue([])
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: `/v1/aulavera/resources?tenantId=${TENANT}&type=${type}`,
      })
      expect(res.statusCode).toBe(200)
      expect(resourcesService.listResources).toHaveBeenCalledWith(TENANT, { type })
    },
  )

  it('type="ebook" (no en enum) → 500 zod throw (no llega al service)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/v1/aulavera/resources?tenantId=${TENANT}&type=ebook`,
    })
    expect(res.statusCode).toBe(500)                  // zod parse error
    expect(resourcesService.listResources).not.toHaveBeenCalled()
  })

  it('happy: lista resources con shape esperado', async () => {
    resourcesService.listResources.mockResolvedValue([
      { id: 'r1', type: 'video', title: 'T1', position: 0 },
      { id: 'r2', type: 'document', title: 'T2', position: 1 },
    ])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/v1/aulavera/resources?tenantId=${TENANT}`,
    })
    expect(res.json()).toHaveLength(2)
  })
})
