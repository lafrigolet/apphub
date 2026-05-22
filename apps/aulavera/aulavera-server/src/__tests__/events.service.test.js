import { describe, it, expect, vi, beforeEach } from 'vitest'

// EXPECTED_APP_ID se lee a través de env.js; aseguramos su valor antes
// de importar el módulo bajo test (env.js corre al cargar).
process.env.EXPECTED_APP_ID = 'aulavera'
process.env.DATABASE_URL    ??= 'postgresql://x:y@localhost:5432/test'
process.env.REDIS_URL       ??= 'redis://localhost:6379'
process.env.PLATFORM_JWT_SECRET ??= 'test_secret_at_least_32_characters_long_ok'

const { withTenantTransactionMock, repoMock } = vi.hoisted(() => ({
  withTenantTransactionMock: vi.fn(),
  repoMock: { listEvents: vi.fn(), findEventById: vi.fn() },
}))

vi.mock('../lib/env.js', () => ({
  env: { EXPECTED_APP_ID: 'aulavera', NODE_ENV: 'test', LOG_LEVEL: 'error' },
}))
vi.mock('../lib/db.js', () => ({
  pool: {},
  withTenantTransaction: withTenantTransactionMock,
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../repositories/events.repository.js', () => repoMock)

import { listEvents, getEvent } from '../services/events.service.js'

const TENANT_A = '70000000-0000-0000-0000-000000000001'
const STUB = { query: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransactionMock.mockImplementation(async (_p, _a, _t, _s, fn) => fn(STUB))
})

describe('listEvents — scoping por (app=aulavera, tenant)', () => {
  it('inyecta EXPECTED_APP_ID="aulavera" en withTenantTransaction (regla CLAUDE.md #2)', async () => {
    repoMock.listEvents.mockResolvedValue([])
    await listEvents(TENANT_A, {})
    expect(withTenantTransactionMock).toHaveBeenCalledWith(
      expect.anything(),    // pool
      'aulavera',           // appId hardcoded del env
      TENANT_A,
      null,                 // subTenantId
      expect.any(Function),
    )
  })

  it('pasa filtros { kind, status } al repo', async () => {
    repoMock.listEvents.mockResolvedValue([{ id: 'e1', kind: 'workshop' }])
    const r = await listEvents(TENANT_A, { kind: 'workshop', status: 'active' })
    expect(repoMock.listEvents).toHaveBeenCalledWith(STUB, { kind: 'workshop', status: 'active' })
    expect(r).toHaveLength(1)
  })

  it('sin filtros, llama a repo.listEvents con undefined kind/status', async () => {
    repoMock.listEvents.mockResolvedValue([])
    await listEvents(TENANT_A, {})
    expect(repoMock.listEvents).toHaveBeenCalledWith(STUB, { kind: undefined, status: undefined })
  })

  it('tenant distinto → withTenantTransaction se invoca con el otro tenant (RLS al rescate)', async () => {
    repoMock.listEvents.mockResolvedValue([])
    const TENANT_B = '70000000-0000-0000-0000-000000000099'
    await listEvents(TENANT_B, {})
    expect(withTenantTransactionMock).toHaveBeenCalledWith(
      expect.anything(), 'aulavera', TENANT_B, null, expect.any(Function),
    )
  })

  it('devuelve la lista del repo sin transformaciones', async () => {
    const rows = [
      { id: 'e1', kind: 'chronicle', title: 'Servimayor' },
      { id: 'e2', kind: 'workshop', title: 'Ruta' },
    ]
    repoMock.listEvents.mockResolvedValue(rows)
    const r = await listEvents(TENANT_A, {})
    expect(r).toEqual(rows)
  })
})

describe('getEvent', () => {
  it('busca por id dentro del scope tenant', async () => {
    repoMock.findEventById.mockResolvedValue({ id: 'e1', kind: 'workshop' })
    const r = await getEvent(TENANT_A, 'e1')
    expect(repoMock.findEventById).toHaveBeenCalledWith(STUB, 'e1')
    expect(withTenantTransactionMock).toHaveBeenCalledWith(
      expect.anything(), 'aulavera', TENANT_A, null, expect.any(Function),
    )
    expect(r.id).toBe('e1')
  })

  it('devuelve null cuando el event no existe', async () => {
    repoMock.findEventById.mockResolvedValue(null)
    const r = await getEvent(TENANT_A, 'no-existe')
    expect(r).toBeNull()
  })
})

describe('cross-tenant guard (RLS contract)', () => {
  it('cada llamada usa EL tenant que recibe — nunca uno hardcoded', async () => {
    repoMock.listEvents.mockResolvedValue([])
    await listEvents('70000000-0000-0000-0000-aaaaaaaaaaaa', {})
    await listEvents('70000000-0000-0000-0000-bbbbbbbbbbbb', {})
    const tenants = withTenantTransactionMock.mock.calls.map((c) => c[2])
    expect(tenants).toEqual([
      '70000000-0000-0000-0000-aaaaaaaaaaaa',
      '70000000-0000-0000-0000-bbbbbbbbbbbb',
    ])
  })
})
