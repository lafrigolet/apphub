import { withTenantTransaction } from '../lib/db.js'
import { ValidationError } from '@apphub/platform-sdk/errors'
import * as blockRepo from '../repositories/blocks.repository.js'
import * as reportRepo from '../repositories/reports.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as realtime from './realtime.service.js'
import { requireStaff, ensureFound } from './guards.js'

// ── blocks ───────────────────────────────────────────────────────────────
export async function block(ctx, blockedUserId) {
  if (blockedUserId === ctx.userId) throw new ValidationError('cannot block yourself')
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    blockRepo.add(c, { appId: ctx.appId, tenantId: ctx.tenantId, userId: ctx.userId, blockedUserId }),
  )
}

export async function unblock(ctx, blockedUserId) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    blockRepo.remove(c, { appId: ctx.appId, tenantId: ctx.tenantId, userId: ctx.userId, blockedUserId }),
  )
}

export async function listBlocks(ctx) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    blockRepo.listForUser(c, ctx.userId),
  )
}

// ── reports ──────────────────────────────────────────────────────────────
export async function report(ctx, input) {
  const created = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    reportRepo.insert(c, {
      appId: ctx.appId, tenantId: ctx.tenantId,
      targetType: input.targetType, targetId: input.targetId,
      reporterUserId: ctx.userId, reason: input.reason,
    }),
  )
  await realtime.notify('chat.message.reported', {
    appId: ctx.appId, tenantId: ctx.tenantId,
    reportId: created.id, targetType: created.target_type, targetId: created.target_id,
    reporterUserId: ctx.userId,
  })
  return created
}

export async function listReports(ctx, filters) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    reportRepo.list(c, filters),
  )
}

export async function updateReport(ctx, id, status) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) =>
    ensureFound(await reportRepo.updateStatus(c, id, status), 'Report'),
  )
}

// ── tenant bans (staff) — a banned user can't post or open conversations ──────
export async function banUser(ctx, userId, reason) {
  requireStaff(ctx)
  if (userId === ctx.userId) throw new ValidationError('cannot ban yourself')
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    banRepo.add(c, { appId: ctx.appId, tenantId: ctx.tenantId, userId, bannedBy: ctx.userId, reason }),
  )
}

export async function unbanUser(ctx, userId) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    banRepo.remove(c, { appId: ctx.appId, tenantId: ctx.tenantId, userId }),
  )
}

export async function listBans(ctx) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) => banRepo.list(c))
}
