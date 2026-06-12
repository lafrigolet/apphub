import { describe, it, expect, vi, beforeEach } from 'vitest'

const { stubClient } = vi.hoisted(() => ({
  stubClient: { query: vi.fn(), release: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(stubClient) },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/redis.js', () => ({ getRedis: vi.fn() }))
vi.mock('../repositories/leads.repository.js', () => ({
  insert:          vi.fn(),
  list:            vi.fn(),
  findById:        vi.fn(),
  findOpenByEmail: vi.fn(),
  touch:           vi.fn(),
  update:          vi.fn(),
  convert:         vi.fn(),
  remove:          vi.fn(),
  insertActivity:  vi.fn(),
  listActivities:  vi.fn(),
}))

import * as service from '../services/leads.service.js'
import * as repo from '../repositories/leads.repository.js'
import { getRedis } from '../lib/redis.js'

const redis = { publish: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  getRedis.mockReturnValue(redis)
  stubClient.query.mockResolvedValue({ rows: [] }) // BEGIN/COMMIT/ROLLBACK
  repo.findOpenByEmail.mockResolvedValue(null)      // por defecto: sin dedup
})

function publishedTypes() {
  return redis.publish.mock.calls.map(([, msg]) => JSON.parse(msg).type)
}

describe('create', () => {
  it('inserta el lead, sella consent_at si hay consentimiento y publica lead.created', async () => {
    repo.insert.mockResolvedValue({ id: 'l1' })
    await service.create({ contactName: 'X', email: 'x@x', consentText: 'Acepto', consentVersion: 'v1' })
    const arg = repo.insert.mock.calls[0][1]
    expect(arg.consentAt).toBeInstanceOf(Date)
    expect(publishedTypes()).toEqual(['lead.created'])
    expect(stubClient.release).toHaveBeenCalled()
  })

  it('sin consentimiento → consentAt null', async () => {
    repo.insert.mockResolvedValue({ id: 'l1' })
    await service.create({ contactName: 'X', email: 'x@x' })
    expect(repo.insert.mock.calls[0][1].consentAt).toBeNull()
  })

  it('libera el cliente incluso si el repo lanza', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db error'))
    await expect(service.create({ email: 'x@x' })).rejects.toThrow('db error')
    expect(stubClient.release).toHaveBeenCalled()
  })
})

describe('create — dedup de leads recurrentes (§4)', () => {
  it('lead abierto con mismo email → adjunta actividad, NO inserta, emite lead.resubmitted', async () => {
    repo.findOpenByEmail.mockResolvedValue({ id: 'existing', status: 'contacted' })
    const r = await service.create({ contactName: 'X', email: 'x@x', message: 'otra vez', source: 'landing', appId: 'aikikan' })

    expect(repo.findOpenByEmail).toHaveBeenCalledWith(stubClient, 'x@x', 'aikikan')
    expect(repo.insert).not.toHaveBeenCalled()
    expect(repo.insertActivity).toHaveBeenCalledWith(stubClient, 'existing', expect.objectContaining({
      type: 'note', body: 'otra vez', metadata: { resubmission: true, source: 'landing' },
    }))
    expect(repo.touch).toHaveBeenCalledWith(stubClient, 'existing')
    const sqls = stubClient.query.mock.calls.map(([s]) => s)
    expect(sqls).toContain('BEGIN')
    expect(sqls).toContain('COMMIT')
    expect(publishedTypes()).toEqual(['lead.resubmitted'])
    expect(r).toEqual({ id: 'existing', status: 'contacted' })
  })

  it('sin lead abierto previo → inserta normal y emite lead.created', async () => {
    repo.findOpenByEmail.mockResolvedValue(null)
    repo.insert.mockResolvedValue({ id: 'new1', status: 'new' })
    await service.create({ contactName: 'X', email: 'nuevo@x', appId: 'aikikan' })
    expect(repo.insert).toHaveBeenCalled()
    expect(publishedTypes()).toEqual(['lead.created'])
  })

  it('error en la transacción de dedup → ROLLBACK y propaga', async () => {
    repo.findOpenByEmail.mockResolvedValue({ id: 'existing', status: 'new' })
    repo.insertActivity.mockRejectedValueOnce(new Error('boom'))
    await expect(service.create({ email: 'x@x', message: 'm' })).rejects.toThrow('boom')
    expect(stubClient.query.mock.calls.map(([s]) => s)).toContain('ROLLBACK')
    expect(stubClient.release).toHaveBeenCalled()
  })
})

describe('listLeads / getById', () => {
  it('delega a repo.list con los filtros', async () => {
    repo.list.mockResolvedValue([{ id: 'l1' }])
    const r = await service.listLeads({ status: 'new', limit: 50 })
    expect(repo.list).toHaveBeenCalledWith(stubClient, { status: 'new', limit: 50 })
    expect(r).toHaveLength(1)
  })

  it('getById devuelve null cuando no existe', async () => {
    repo.findById.mockResolvedValue(null)
    expect(await service.getById('no')).toBeNull()
  })
})

describe('update', () => {
  const actor = { userId: 'u1', email: 's@x' }

  it('cambio de estado → activity status_change + evento lead.status_changed, en transacción', async () => {
    repo.findById.mockResolvedValue({ id: 'l1', status: 'new', assigned_to: null })
    repo.update.mockResolvedValue({ id: 'l1', status: 'contacted' })
    const r = await service.update('l1', { status: 'contacted' }, actor)
    expect(repo.insertActivity).toHaveBeenCalledWith(stubClient, 'l1', expect.objectContaining({
      type: 'status_change', authorUserId: 'u1',
      metadata: { from: 'new', to: 'contacted' },
    }))
    const sqls = stubClient.query.mock.calls.map(([s]) => s)
    expect(sqls).toContain('BEGIN')
    expect(sqls).toContain('COMMIT')
    expect(publishedTypes()).toEqual(['lead.status_changed'])
    expect(r).toEqual({ id: 'l1', status: 'contacted' })
  })

  it('reasignación → activity assignment + evento lead.assigned', async () => {
    repo.findById.mockResolvedValue({ id: 'l1', status: 'new', assigned_to: null })
    repo.update.mockResolvedValue({ id: 'l1', assigned_to: 'u2' })
    await service.update('l1', { assignedTo: 'u2' }, actor)
    expect(repo.insertActivity).toHaveBeenCalledWith(stubClient, 'l1', expect.objectContaining({
      type: 'assignment', metadata: { from: null, to: 'u2' },
    }))
    expect(publishedTypes()).toEqual(['lead.assigned'])
  })

  it('mismo estado → ni activity ni evento', async () => {
    repo.findById.mockResolvedValue({ id: 'l1', status: 'new', assigned_to: null })
    repo.update.mockResolvedValue({ id: 'l1', status: 'new' })
    await service.update('l1', { status: 'new', score: 50 }, actor)
    expect(repo.insertActivity).not.toHaveBeenCalled()
    expect(redis.publish).not.toHaveBeenCalled()
  })

  it('lead inexistente → null + ROLLBACK', async () => {
    repo.findById.mockResolvedValue(null)
    expect(await service.update('ghost', { status: 'lost' }, actor)).toBeNull()
    expect(stubClient.query.mock.calls.map(([s]) => s)).toContain('ROLLBACK')
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('repo lanza → ROLLBACK y propaga', async () => {
    repo.findById.mockResolvedValue({ id: 'l1', status: 'new' })
    repo.update.mockRejectedValueOnce(new Error('boom'))
    await expect(service.update('l1', { status: 'lost' }, actor)).rejects.toThrow('boom')
    expect(stubClient.query.mock.calls.map(([s]) => s)).toContain('ROLLBACK')
  })
})

describe('convert', () => {
  const actor = { userId: 'u1' }

  it('convierte, escribe activity system y publica lead.converted', async () => {
    repo.convert.mockResolvedValue({ id: 'l1', status: 'won', converted_tenant_id: 't1' })
    const r = await service.convert('l1', 't1', actor)
    expect(repo.insertActivity).toHaveBeenCalledWith(stubClient, 'l1', expect.objectContaining({
      type: 'system', metadata: { tenantId: 't1' },
    }))
    expect(publishedTypes()).toEqual(['lead.converted'])
    expect(r).toEqual({ lead: { id: 'l1', status: 'won', converted_tenant_id: 't1' } })
  })

  it('ya convertido → { conflict: true }', async () => {
    repo.convert.mockResolvedValue(null)
    repo.findById.mockResolvedValue({ id: 'l1', converted_tenant_id: 't0' })
    expect(await service.convert('l1', 't1', actor)).toEqual({ conflict: true })
    expect(redis.publish).not.toHaveBeenCalled()
  })

  it('inexistente → null', async () => {
    repo.convert.mockResolvedValue(null)
    repo.findById.mockResolvedValue(null)
    expect(await service.convert('ghost', 't1', actor)).toBeNull()
  })
})

describe('removeLead (GDPR)', () => {
  it('borra y publica lead.deleted SIN email en el payload', async () => {
    repo.remove.mockResolvedValue({ id: 'l1', email: 'x@x' })
    const r = await service.removeLead('l1', { userId: 'u1' })
    expect(r).toEqual({ id: 'l1', email: 'x@x' })
    const [, msg] = redis.publish.mock.calls[0]
    const evt = JSON.parse(msg)
    expect(evt.type).toBe('lead.deleted')
    expect(evt.payload.email).toBeUndefined()
  })

  it('inexistente → null sin evento', async () => {
    repo.remove.mockResolvedValue(null)
    expect(await service.removeLead('ghost')).toBeNull()
    expect(redis.publish).not.toHaveBeenCalled()
  })
})

describe('activities', () => {
  it('addActivity adjunta autor y delega', async () => {
    repo.findById.mockResolvedValue({ id: 'l1' })
    repo.insertActivity.mockResolvedValue({ id: 'a1' })
    const r = await service.addActivity('l1', { type: 'note', body: 'hola' }, { userId: 'u1', email: 's@x' })
    expect(repo.insertActivity).toHaveBeenCalledWith(stubClient, 'l1', expect.objectContaining({
      type: 'note', body: 'hola', authorUserId: 'u1', authorEmail: 's@x',
    }))
    expect(r).toEqual({ id: 'a1' })
  })

  it('addActivity sobre lead inexistente → null', async () => {
    repo.findById.mockResolvedValue(null)
    expect(await service.addActivity('ghost', { type: 'note', body: 'x' })).toBeNull()
    expect(repo.insertActivity).not.toHaveBeenCalled()
  })

  it('listActivities sobre lead inexistente → null', async () => {
    repo.findById.mockResolvedValue(null)
    expect(await service.listActivities('ghost', {})).toBeNull()
  })

  it('listActivities delega con paginación', async () => {
    repo.findById.mockResolvedValue({ id: 'l1' })
    repo.listActivities.mockResolvedValue([{ id: 'a1' }])
    expect(await service.listActivities('l1', { limit: 10 })).toEqual([{ id: 'a1' }])
  })
})

describe('setStatus (legacy)', () => {
  it('delega en update()', async () => {
    repo.findById.mockResolvedValue({ id: 'l1', status: 'new' })
    repo.update.mockResolvedValue({ id: 'l1', status: 'contacted' })
    await service.setStatus('l1', 'contacted', 'nota')
    expect(repo.update).toHaveBeenCalledWith(stubClient, 'l1', { status: 'contacted', staffNotes: 'nota' })
  })
})

describe('resiliencia de publish', () => {
  it('fallo al publicar NO propaga (el lead ya está persistido)', async () => {
    repo.insert.mockResolvedValue({ id: 'l1' })
    redis.publish.mockRejectedValueOnce(new Error('redis down'))
    await expect(service.create({ email: 'x@x' })).resolves.toEqual({ id: 'l1' })
  })

  it('sin redis configurado → no-op', async () => {
    getRedis.mockReturnValue(null)
    repo.insert.mockResolvedValue({ id: 'l1' })
    await expect(service.create({ email: 'x@x' })).resolves.toEqual({ id: 'l1' })
  })
})
