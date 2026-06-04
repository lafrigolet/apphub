import { withTenantTransaction } from '../lib/db.js'
import { ConflictError } from '@apphub/platform-sdk/errors'
import * as convRepo from '../repositories/conversations.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as csatRepo from '../repositories/csat.repository.js'
import * as macroRepo from '../repositories/macros.repository.js'
import * as realtime from './realtime.service.js'
import { requireStaff, ensureParticipant, ensureFound } from './guards.js'
import { create as createConversation } from './conversations.service.js'

// Queue routing lives in conversations.service (it mutates the conversation);
// re-exported here so the support routes can reach it via one namespace.
export { setQueue } from './conversations.service.js'

// A member opens a support ticket. Backed by a 'support' conversation.
export async function open(ctx, input) {
  return createConversation(ctx, {
    type: 'support',
    subject: input.subject,
    priority: input.priority,
    participantIds: input.agentIds ?? [],
  })
}

// Staff: list the support queue (oldest-first), optionally filtered by status.
export async function queue(ctx, filters) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    convRepo.listSupportQueue(c, filters),
  )
}

// Staff: assign (or reassign) an agent. The agent is also added as a
// participant so they receive real-time frames.
export async function assign(ctx, id, agentUserId) {
  requireStaff(ctx)
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    if (conv.type !== 'support') throw new ConflictError('not a support conversation')
    await partRepo.insert(c, { conversationId: id, userId: agentUserId, appId: ctx.appId, tenantId: ctx.tenantId, role: 'agent' })
    const updated = await convRepo.update(c, id, {
      assigned_agent_user_id: agentUserId,
      support_status: conv.support_status === 'open' ? 'pending' : conv.support_status,
    })
    const participants = await partRepo.list(c, id)
    return { updated, recipients: participants.map((p) => p.user_id) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId: id, type: 'participant.changed', payload: { event: 'assigned', conversation: result.updated },
  })
  await realtime.notify('chat.support.assigned', {
    appId: ctx.appId, tenantId: ctx.tenantId, conversationId: id, agentUserId,
  })
  return result.updated
}

// Staff: set support status / priority.
export async function updateSupport(ctx, id, fields) {
  requireStaff(ctx)
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    if (conv.type !== 'support') throw new ConflictError('not a support conversation')
    const updated = await convRepo.update(c, id, {
      support_status: fields.supportStatus,
      priority: fields.priority,
    })
    const participants = await partRepo.list(c, id)
    return { updated, recipients: participants.map((p) => p.user_id) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId: id, type: 'participant.changed', payload: { event: 'support_updated', conversation: result.updated },
  })
  return result.updated
}

// ── CSAT ─────────────────────────────────────────────────────────────────────
export async function submitCsat(ctx, conversationId, { rating, comment }) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    if (conv.type !== 'support') throw new ConflictError('not a support conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    return csatRepo.insert(c, { appId: ctx.appId, tenantId: ctx.tenantId, conversationId, rating, comment, submittedBy: ctx.userId })
  })
}

export async function getCsat(ctx, conversationId) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    csatRepo.getForConversation(c, conversationId),
  )
}

// ── macros (canned responses) ────────────────────────────────────────────────
export async function listMacros(ctx) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) => macroRepo.list(c))
}

export async function createMacro(ctx, { title, body }) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    macroRepo.insert(c, { appId: ctx.appId, tenantId: ctx.tenantId, title, body, createdBy: ctx.userId }),
  )
}

export async function updateMacro(ctx, id, fields) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) =>
    ensureFound(await macroRepo.update(c, id, fields), 'Macro'),
  )
}

export async function deleteMacro(ctx, id) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const ok = await macroRepo.remove(c, id)
    if (!ok) throw ensureFound(null, 'Macro')
    return { ok: true }
  })
}
