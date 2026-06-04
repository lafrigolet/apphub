import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── unit-level mocks (services under test) ───────────────────────────────────
vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z' } }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../lib/ratelimit.js', () => ({ enforceRate: vi.fn().mockResolvedValue() }))
vi.mock('../repositories/messages.repository.js')
vi.mock('../repositories/macros.repository.js')
vi.mock('../repositories/bans.repository.js')
vi.mock('../repositories/settings.repository.js')
vi.mock('../services/realtime.service.js', () => ({ emit: vi.fn().mockResolvedValue(), notify: vi.fn().mockResolvedValue() }))

import * as msg from '../services/messages.service.js'
import * as support from '../services/support.service.js'
import * as moderation from '../services/moderation.service.js'
import * as settings from '../services/settings.service.js'
import * as search from '../services/search.service.js'
import { slaMinutesFor } from '../services/settings.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as macroRepo from '../repositories/macros.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'

const user = { userId: 'u', appId: 'platform', tenantId: 't1', subTenantId: null, role: 'user' }
const staff = { ...user, userId: 's', role: 'staff' }
const FUTURE = new Date(Date.now() + 3600_000).toISOString()
const PAST = new Date(Date.now() - 3600_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({}))
})

// ── #3 scheduled message list / cancel / reschedule ──────────────────────────
describe('scheduled messages — list/cancel/reschedule', () => {
  it('listScheduled delegates to the sender-scoped repo query', async () => {
    msgRepo.listScheduledForSender.mockResolvedValue([{ id: 'm1', status: 'scheduled' }])
    const out = await msg.listScheduled(user, { conversationId: 'c1', limit: 10 })
    expect(out).toHaveLength(1)
    expect(msgRepo.listScheduledForSender).toHaveBeenCalledWith({}, 'u', { conversationId: 'c1', limit: 10 })
  })
  it('cancelScheduled returns the cancelled row', async () => {
    msgRepo.cancelScheduled.mockResolvedValue({ id: 'm1', status: 'cancelled' })
    expect((await msg.cancelScheduled(user, 'm1')).status).toBe('cancelled')
  })
  it('cancelScheduled 404 when nothing pending matched', async () => {
    msgRepo.cancelScheduled.mockResolvedValue(null)
    await expect(msg.cancelScheduled(user, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
  it('rescheduleScheduled requires a future time', async () => {
    await expect(msg.rescheduleScheduled(user, 'm1', PAST)).rejects.toMatchObject({ statusCode: 422 })
  })
  it('rescheduleScheduled updates and 404s on miss', async () => {
    msgRepo.rescheduleScheduled.mockResolvedValue({ id: 'm1', scheduled_for: FUTURE })
    expect((await msg.rescheduleScheduled(user, 'm1', FUTURE)).id).toBe('m1')
    msgRepo.rescheduleScheduled.mockResolvedValue(null)
    await expect(msg.rescheduleScheduled(user, 'm1', FUTURE)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('messages.repository — scheduled helpers', () => {
  const client = (rows = []) => ({ query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) })
  it('listScheduledForSender scopes to sender + status', async () => {
    const { listScheduledForSender, cancelScheduled, rescheduleScheduled } = await vi.importActual('../repositories/messages.repository.js')
    const c = client([{ id: 'm1' }])
    await listScheduledForSender(c, 'u', { conversationId: 'c1', limit: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = 'scheduled'/)
    expect(sql).toMatch(/sender_user_id = \$1/)
    expect(params).toEqual(['u', 'c1', 5])
    const c2 = client([{ id: 'm1', status: 'cancelled' }])
    await cancelScheduled(c2, 'm1', 'u', 'now')
    expect(c2.query.mock.calls[0][0]).toMatch(/SET status = 'cancelled', cancelled_at = \$3/)
    const c3 = client([{ id: 'm1' }])
    await rescheduleScheduled(c3, 'm1', 'u', 'later')
    expect(c3.query.mock.calls[0][0]).toMatch(/SET scheduled_for = \$3/)
  })
})

// ── #6 temporary bans ────────────────────────────────────────────────────────
describe('temporary bans', () => {
  it('banUser rejects a past bannedUntil', async () => {
    await expect(moderation.banUser(staff, 'x', 'r', PAST)).rejects.toMatchObject({ statusCode: 422 })
  })
  it('banUser forwards bannedUntil to the repo', async () => {
    banRepo.add.mockResolvedValue({ user_id: 'x', banned_until: FUTURE })
    const out = await moderation.banUser(staff, 'x', 'spam', FUTURE)
    expect(out.banned_until).toBe(FUTURE)
    expect(banRepo.add.mock.calls[0][1]).toMatchObject({ bannedUntil: FUTURE })
  })
  it('isBanned ignores lapsed timed bans (SQL filter present)', async () => {
    const { isBanned } = await vi.importActual('../repositories/bans.repository.js')
    const c = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await isBanned(c, 'u')
    expect(c.query.mock.calls[0][0]).toMatch(/banned_until IS NULL OR banned_until > now\(\)/)
  })
})

// ── #10 macro edit ──────────────────────────────────────────────────────────
describe('macro edit', () => {
  it('updateMacro requires staff', async () => {
    await expect(support.updateMacro(user, 'm1', { title: 'T' })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('updateMacro returns the row, 404 on miss', async () => {
    macroRepo.update.mockResolvedValue({ id: 'm1', title: 'T2' })
    expect((await support.updateMacro(staff, 'm1', { title: 'T2' })).title).toBe('T2')
    macroRepo.update.mockResolvedValue(null)
    await expect(support.updateMacro(staff, 'ghost', { body: 'B' })).rejects.toMatchObject({ statusCode: 404 })
  })
  it('repo update COALESCEs unspecified fields', async () => {
    const { update } = await vi.importActual('../repositories/macros.repository.js')
    const c = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'm1' }] }) }
    await update(c, 'm1', { title: 'T2' })
    expect(c.query.mock.calls[0][0]).toMatch(/title = COALESCE\(\$2, title\)/)
  })
})

// ── #4 SLA thresholds ────────────────────────────────────────────────────────
describe('SLA thresholds in settings', () => {
  it('slaMinutesFor reads the per-priority column with fallback', () => {
    const s = { sla_minutes_urgent: 60, sla_minutes_normal: null }
    expect(slaMinutesFor(s, 'urgent', 480)).toBe(60)
    expect(slaMinutesFor(s, 'normal', 480)).toBe(480)
    expect(slaMinutesFor(s, 'bogus', 480)).toBe(480)
  })
  it('upsertForTenant persists SLA + search language', async () => {
    settingsRepo.upsert.mockResolvedValue({ app_id: 'platform' })
    await settings.upsertForTenant(staff, { slaMinutesUrgent: 30, searchLanguage: 'spanish' })
    expect(settingsRepo.upsert.mock.calls[0][3]).toMatchObject({ slaMinutesUrgent: 30, searchLanguage: 'spanish' })
  })
  it('upsertForTenant rejects an unknown search language', async () => {
    await expect(settings.upsertForTenant(staff, { searchLanguage: 'klingon' })).rejects.toMatchObject({ statusCode: 422 })
  })
  it('default settings expose simple search language + null SLAs', () => {
    expect(settings.DEFAULT_SETTINGS.search_language).toBe('simple')
    expect(settings.DEFAULT_SETTINGS.sla_minutes_urgent).toBeNull()
  })
})

// ── #9 per-tenant search language ────────────────────────────────────────────
describe('search language', () => {
  it('passes tenant language down to the repo', async () => {
    settingsRepo.find.mockResolvedValue({ search_language: 'spanish' })
    msgRepo.search.mockResolvedValue([])
    await search.search(user, 'hola')
    expect(msgRepo.search.mock.calls[0][3]).toMatchObject({ language: 'spanish' })
  })
  it('falls back to simple when language is unknown', async () => {
    settingsRepo.find.mockResolvedValue({ search_language: 'nonsense' })
    msgRepo.search.mockResolvedValue([])
    await search.search(user, 'hi')
    expect(msgRepo.search.mock.calls[0][3]).toMatchObject({ language: 'simple' })
  })
  it('repo search uses an inline regconfig for non-simple languages', async () => {
    const { search: repoSearch } = await vi.importActual('../repositories/messages.repository.js')
    const c = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await repoSearch(c, 'u', 'hola', { language: 'spanish' })
    const sql = c.query.mock.calls[0][0]
    expect(sql).toMatch(/to_tsvector\('spanish', coalesce\(m\.body, ''\)\)/)
    expect(sql).toMatch(/plainto_tsquery\('spanish', \$2\)/)
  })
  it('repo search keeps the indexed body_tsv path for simple', async () => {
    const { search: repoSearch } = await vi.importActual('../repositories/messages.repository.js')
    const c = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await repoSearch(c, 'u', 'hi', { language: 'simple' })
    expect(c.query.mock.calls[0][0]).toMatch(/m\.body_tsv @@ plainto_tsquery\('simple', \$2\)/)
  })
})
