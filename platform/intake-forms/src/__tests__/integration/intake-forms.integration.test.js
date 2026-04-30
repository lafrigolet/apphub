/**
 * Integration tests for platform/intake-forms — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-intake-forms test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createTemplate, getTemplate, listTemplates, publishTemplate,
  createSubmission, getSubmission, submitAnswers, reviewSubmission,
  handleEvent,
} from '../../services/intake-forms.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-if'
const TENANT_ID = '00000000-0000-0000-0000-0000000002e1'

let adminPool, redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  redis = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  redis.disconnect()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_intake_forms.submissions WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_intake_forms.templates   WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_services.services        WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'reviewer', ...overrides,
})

async function seedServiceWithIntake(intakeFormId) {
  const id = uuidv4()
  await adminPool.query(
    `INSERT INTO platform_services.services
       (id, app_id, tenant_id, code, name, duration_minutes, requires_intake_form, intake_form_id)
     VALUES ($1,$2,$3,$4,'svc',30,TRUE,$5)`,
    [id, APP_ID, TENANT_ID, 'I-' + uuidv4().slice(0, 6), intakeFormId],
  )
  return id
}

describe('templates', () => {
  it('persists, requires publish before submission', async () => {
    const t = await createTemplate(ctx(), { code: 'T-' + uuidv4().slice(0, 4), name: 'Anamnesis', schema: { fields: [] } })
    expect(t.is_published).toBe(false)
    await expect(createSubmission(ctx(), { templateId: t.id })).rejects.toThrow(ConflictError)
    await publishTemplate(ctx(), t.id)
    const sub = await createSubmission(ctx(), { templateId: t.id })
    expect(sub.id).toBeTruthy()
  })

  it('getTemplate / publishTemplate throw NotFoundError on unknown ids', async () => {
    await expect(getTemplate(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
    await expect(publishTemplate(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })

  it('listTemplates filters by is_published', async () => {
    const a = await createTemplate(ctx(), { code: 'A-' + uuidv4().slice(0, 4), name: 'A', schema: {} })
    const b = await createTemplate(ctx(), { code: 'B-' + uuidv4().slice(0, 4), name: 'B', schema: {} })
    await publishTemplate(ctx(), b.id)
    const onlyPublished = await listTemplates(ctx(), { onlyPublished: true })
    expect(onlyPublished.find((t) => t.id === b.id)).toBeTruthy()
    expect(onlyPublished.find((t) => t.id === a.id)).toBeFalsy()
  })
})

describe('submissions', () => {
  it('submit + review workflow', async () => {
    const t = await createTemplate(ctx(), { code: 'S-' + uuidv4().slice(0, 4), name: 'X', schema: {} })
    await publishTemplate(ctx(), t.id)
    const s = await createSubmission(ctx(), { templateId: t.id })
    expect(s.status).toBe('pending')

    const submitted = await submitAnswers(ctx(), s.id, { answers: { q1: 'a' } })
    expect(submitted.status).toBe('submitted')
    expect(submitted.submitted_at).toBeTruthy()

    const reviewed = await reviewSubmission(ctx(), s.id)
    expect(reviewed.status).toBe('reviewed')
    expect(reviewed.reviewed_at).toBeTruthy()
  })

  it('submitAnswers / reviewSubmission throw NotFoundError on unknown ids', async () => {
    await expect(submitAnswers(ctx(), uuidv4(), { answers: {} })).rejects.toThrow(NotFoundError)
    await expect(reviewSubmission(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })

  it('submitAnswers publishes intake.submitted', async () => {
    const t = await createTemplate(ctx(), { code: 'E-' + uuidv4().slice(0, 4), name: 'E', schema: {} })
    await publishTemplate(ctx(), t.id)
    const s = await createSubmission(ctx(), { templateId: t.id })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))
    try {
      await submitAnswers(ctx(), s.id, { answers: { x: 1 } })
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'intake.submitted' && e.payload.submissionId === s.id)) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'intake.submitted')).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('getSubmission throws NotFoundError on unknown id', async () => {
    await expect(getSubmission(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — booking.confirmed auto-creates submission', () => {
  it('creates a pending submission when service requires intake', async () => {
    const t = await createTemplate(ctx(), { code: 'AUTO-' + uuidv4().slice(0, 4), name: 'X', schema: {} })
    await publishTemplate(ctx(), t.id)
    const sid = await seedServiceWithIntake(t.id)

    const bookingId = uuidv4()
    await handleEvent({
      type: 'booking.confirmed',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID,
        bookingId, serviceId: sid, clientUserId: uuidv4(),
      },
    })

    const { rows } = await adminPool.query(
      `SELECT * FROM platform_intake_forms.submissions
       WHERE app_id=$1 AND booking_id=$2`,
      [APP_ID, bookingId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].template_id).toBe(t.id)
  })

  it('skips when service does not require intake', async () => {
    const sid = uuidv4()
    await adminPool.query(
      `INSERT INTO platform_services.services
         (id, app_id, tenant_id, code, name, duration_minutes)
       VALUES ($1,$2,$3,$4,'svc',30)`,
      [sid, APP_ID, TENANT_ID, 'NOREQ-' + uuidv4().slice(0, 6)],
    )
    const bookingId = uuidv4()
    await handleEvent({
      type: 'booking.confirmed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId, serviceId: sid, clientUserId: uuidv4() },
    })
    const { rows } = await adminPool.query(
      `SELECT * FROM platform_intake_forms.submissions
       WHERE app_id=$1 AND booking_id=$2`,
      [APP_ID, bookingId],
    )
    expect(rows).toHaveLength(0)
  })

  it('de-dupes when a submission already exists', async () => {
    const t = await createTemplate(ctx(), { code: 'D-' + uuidv4().slice(0, 4), name: 'X', schema: {} })
    await publishTemplate(ctx(), t.id)
    const sid = await seedServiceWithIntake(t.id)
    const bookingId = uuidv4()
    await handleEvent({
      type: 'booking.confirmed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId, serviceId: sid, clientUserId: uuidv4() },
    })
    await handleEvent({
      type: 'booking.confirmed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, bookingId, serviceId: sid, clientUserId: uuidv4() },
    })
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS c FROM platform_intake_forms.submissions
       WHERE app_id=$1 AND booking_id=$2`,
      [APP_ID, bookingId],
    )
    expect(rows[0].c).toBe(1)
  })
})
