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
vi.mock('../repositories/leads.repository.js', () => ({
  insert:        vi.fn(),
  list:          vi.fn(),
  findById:      vi.fn(),
  updateStatus:  vi.fn(),
}))

import * as service from '../services/leads.service.js'
import * as repo from '../repositories/leads.repository.js'

beforeEach(() => vi.clearAllMocks())

describe('create', () => {
  it('inserta el lead y libera el cliente', async () => {
    repo.insert.mockResolvedValue({ id: 'l1', email: 'x@x' })
    const r = await service.create({ contactName: 'X', email: 'x@x' })
    expect(repo.insert).toHaveBeenCalledWith(stubClient, { contactName: 'X', email: 'x@x' })
    expect(r).toEqual({ id: 'l1', email: 'x@x' })
    expect(stubClient.release).toHaveBeenCalled()
  })

  it('libera el cliente incluso si el repo lanza', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db error'))
    await expect(service.create({ email: 'x@x' })).rejects.toThrow('db error')
    expect(stubClient.release).toHaveBeenCalled()
  })
})

describe('listLeads', () => {
  it('delega a repo.list con los filtros', async () => {
    repo.list.mockResolvedValue([{ id: 'l1' }])
    const r = await service.listLeads({ status: 'new', limit: 50 })
    expect(repo.list).toHaveBeenCalledWith(stubClient, { status: 'new', limit: 50 })
    expect(r).toHaveLength(1)
  })
})

describe('getById', () => {
  it('devuelve el lead encontrado', async () => {
    repo.findById.mockResolvedValue({ id: 'l1', email: 'x@x' })
    const r = await service.getById('l1')
    expect(r.id).toBe('l1')
  })
  it('devuelve null cuando no existe', async () => {
    repo.findById.mockResolvedValue(null)
    const r = await service.getById('no')
    expect(r).toBeNull()
  })
})

describe('setStatus', () => {
  it('delega a repo.updateStatus con id + status + notas', async () => {
    repo.updateStatus.mockResolvedValue({ id: 'l1', status: 'contacted' })
    await service.setStatus('l1', 'contacted', 'Llamamos el martes')
    expect(repo.updateStatus).toHaveBeenCalledWith(stubClient, 'l1', 'contacted', 'Llamamos el martes')
  })
})
