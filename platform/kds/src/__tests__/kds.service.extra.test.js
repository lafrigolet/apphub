// Cobertura complementaria del service: ruta feliz de getTicket (devuelve el
// ticket con sus items embebidos).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() }, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/kds.repository.js')

import { getTicket } from '../services/kds.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/kds.repository.js'

const ctx = { appId: 'resto', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'kitchen' }
const TICKET = '11111111-1111-1111-1111-111111111111'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

it('getTicket returns the ticket with its embedded items', async () => {
  repo.findTicketById.mockResolvedValue({ id: TICKET, status: 'fired' })
  repo.findItemsByTicket.mockResolvedValue([{ id: 'i1', sku: 'X' }])
  const result = await getTicket(ctx, TICKET)
  expect(result).toEqual({ id: TICKET, status: 'fired', items: [{ id: 'i1', sku: 'X' }] })
  expect(repo.findItemsByTicket).toHaveBeenCalledWith(expect.anything(), 'resto', 't1', TICKET)
})
