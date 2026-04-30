import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('../repositories/intake-forms.repository.js')

import * as service from '../services/intake-forms.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/intake-forms.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TPL_ID    = '11111111-1111-1111-1111-111111111111'
const SUB_ID    = '22222222-2222-2222-2222-222222222222'
const BOOK_ID   = '33333333-3333-3333-3333-333333333333'
const SVC_ID    = '44444444-4444-4444-4444-444444444444'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('templates', () => {
  it('createTemplate scopes', async () => {
    repo.insertTemplate.mockResolvedValue({ id: TPL_ID })
    await service.createTemplate(ctx, { code: 'C', name: 'C', schema: { fields: [] } })
    expect(repo.insertTemplate).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ code: 'C', name: 'C' }),
    )
  })

  it('getTemplate throws NotFoundError when missing', async () => {
    repo.findTemplateById.mockResolvedValue(null)
    await expect(service.getTemplate(ctx, TPL_ID)).rejects.toThrow(NotFoundError)
  })

  it('publishTemplate throws NotFoundError when missing', async () => {
    repo.publishTemplate.mockResolvedValue(null)
    await expect(service.publishTemplate(ctx, TPL_ID)).rejects.toThrow(NotFoundError)
  })

  it('listTemplates passes options', async () => {
    repo.listTemplates.mockResolvedValue([])
    await service.listTemplates(ctx, { onlyPublished: true })
    expect(repo.listTemplates).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { onlyPublished: true })
  })
})

describe('submissions', () => {
  it('createSubmission requires a published template', async () => {
    repo.findTemplateById.mockResolvedValue({ id: TPL_ID, is_published: false })
    await expect(service.createSubmission(ctx, { templateId: TPL_ID })).rejects.toThrow(ConflictError)
  })

  it('createSubmission throws NotFoundError when template missing', async () => {
    repo.findTemplateById.mockResolvedValue(null)
    await expect(service.createSubmission(ctx, { templateId: TPL_ID })).rejects.toThrow(NotFoundError)
  })

  it('createSubmission persists when template is published', async () => {
    repo.findTemplateById.mockResolvedValue({ id: TPL_ID, is_published: true })
    repo.insertSubmission.mockResolvedValue({ id: SUB_ID })
    await service.createSubmission(ctx, { templateId: TPL_ID })
    expect(repo.insertSubmission).toHaveBeenCalled()
  })

  it('submitAnswers publishes intake.submitted', async () => {
    repo.submitAnswers.mockResolvedValue({
      id: SUB_ID, booking_id: BOOK_ID, template_id: TPL_ID, client_user_id: 'u1',
    })
    await service.submitAnswers(ctx, SUB_ID, { answers: { q1: 'a' } })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'intake.submitted',
      payload: expect.objectContaining({ submissionId: SUB_ID, bookingId: BOOK_ID }),
    }))
  })

  it('submitAnswers throws NotFoundError when submission missing', async () => {
    repo.submitAnswers.mockResolvedValue(null)
    await expect(service.submitAnswers(ctx, SUB_ID, { answers: {} })).rejects.toThrow(NotFoundError)
  })

  it('reviewSubmission stamps reviewer', async () => {
    repo.reviewSubmission.mockResolvedValue({ id: SUB_ID, status: 'reviewed' })
    await service.reviewSubmission(ctx, SUB_ID)
    expect(repo.reviewSubmission).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, SUB_ID, 'u1')
  })

  it('reviewSubmission throws NotFoundError when missing', async () => {
    repo.reviewSubmission.mockResolvedValue(null)
    await expect(service.reviewSubmission(ctx, SUB_ID)).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — booking.confirmed → intake.requested', () => {
  it('skips when service does not require intake form', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ requires_intake_form: false, intake_form_id: null }] })
      return fn(c)
    })
    await service.handleEvent({
      type: 'booking.confirmed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID, clientUserId: 'u1' },
    })
    expect(repo.insertSubmission).not.toHaveBeenCalled()
  })

  it('creates submission + publishes intake.requested when service requires intake', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ requires_intake_form: true, intake_form_id: TPL_ID }] })
      return fn(c)
    })
    repo.findSubmissionByBookingId.mockResolvedValue(null)
    repo.insertSubmission.mockResolvedValue({ id: SUB_ID })

    await service.handleEvent({
      type: 'booking.confirmed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID, clientUserId: 'u1' },
    })

    expect(repo.insertSubmission).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ templateId: TPL_ID, bookingId: BOOK_ID, status: 'pending' }),
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'intake.requested' }))
  })

  it('de-dupes when a submission already exists for the booking', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ requires_intake_form: true, intake_form_id: TPL_ID }] })
      return fn(c)
    })
    repo.findSubmissionByBookingId.mockResolvedValue({ id: 'existing' })
    await service.handleEvent({
      type: 'booking.confirmed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID, clientUserId: 'u1' },
    })
    expect(repo.insertSubmission).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('ignores unrelated event types', async () => {
    await service.handleEvent({ type: 'order.paid', payload: {} })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('swallows downstream errors', async () => {
    withTenantTransaction.mockImplementation(async () => { throw new Error('boom') })
    await expect(service.handleEvent({
      type: 'booking.confirmed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId: BOOK_ID, serviceId: SVC_ID, clientUserId: 'u1' },
    })).resolves.toBeUndefined()
  })
})
