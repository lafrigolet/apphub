import { withTenantTransaction } from '../lib/db.js'
import { ValidationError } from '@apphub/platform-sdk/errors'
import * as blockRepo from '../repositories/blocks.repository.js'
import * as reportRepo from '../repositories/reports.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
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
  const created = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    // For a message report, resolve the reported user (the message's sender) so
    // staff can later pull a per-user report history. Best-effort: null if the
    // target isn't a known message.
    let targetUserId = null
    if (input.targetType === 'message') {
      const msg = await msgRepo.findById(c, input.targetId)
      targetUserId = msg?.sender_user_id ?? null
    }
    return reportRepo.insert(c, {
      appId: ctx.appId, tenantId: ctx.tenantId,
      targetType: input.targetType, targetId: input.targetId, targetUserId,
      reporterUserId: ctx.userId, reason: input.reason,
    })
  })
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

// Staff: how many times (and which) reports name a given user as the target.
// Helps spot repeat offenders (chat.md §18 report-history-per-user).
export async function listUserReports(ctx, targetUserId, filters) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    reportRepo.listForTargetUser(c, targetUserId, filters),
  )
}

// ── GDPR right-to-be-forgotten ────────────────────────────────────────────
// Staff erases a user's chat footprint in this tenant: messages keep their slot
// (so threads/receipts stay coherent) but are detached + body-wiped; reactions,
// mentions and blocks are dropped; the user leaves every conversation. Emits
// chat.user.erased on the bus so other modules can mirror the erasure.
export async function eraseUserData(ctx, targetUserId) {
  requireStaff(ctx)
  const now = new Date().toISOString()
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const messagesAnonymized = await msgRepo.anonymizeUser(c, targetUserId)
    await blockRepo.purgeUser(c, targetUserId)
    const conversationsLeft = await partRepo.leaveAllForUser(c, targetUserId, now)
    return { messagesAnonymized, conversationsLeft }
  })
  await realtime.notify('chat.user.erased', {
    appId: ctx.appId, tenantId: ctx.tenantId, userId: targetUserId, erasedBy: ctx.userId,
    messagesAnonymized: result.messagesAnonymized,
  })
  return { userId: targetUserId, ...result, conversationsLeft: result.conversationsLeft.length }
}

// ── tenant bans (staff) — a banned user can't post or open conversations ──────
// bannedUntil (optional ISO timestamp) makes the ban temporary; omit for an
// indefinite ban. A timestamp in the past is rejected.
export async function banUser(ctx, userId, reason, bannedUntil = null) {
  requireStaff(ctx)
  if (userId === ctx.userId) throw new ValidationError('cannot ban yourself')
  if (bannedUntil && new Date(bannedUntil).getTime() <= Date.now()) {
    throw new ValidationError('bannedUntil must be in the future')
  }
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    banRepo.add(c, { appId: ctx.appId, tenantId: ctx.tenantId, userId, bannedBy: ctx.userId, reason, bannedUntil }),
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
