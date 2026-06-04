import { randomUUID } from 'node:crypto'
import { withTenantTransaction } from '../lib/db.js'
import { ValidationError, ConflictError, ForbiddenError } from '@apphub/platform-sdk/errors'
import * as convRepo from '../repositories/conversations.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as blockRepo from '../repositories/blocks.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as inviteRepo from '../repositories/invites.repository.js'
import * as realtime from './realtime.service.js'
import { resolve as resolveSettings } from './settings.service.js'
import { ensureParticipant, ensureManager, ensureFound, isStaff, MANAGER_ROLES } from './guards.js'

function newInviteCode() {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

// Canonical dedupe key for a 1:1 conversation: the two ids sorted + joined,
// so (A,B) and (B,A) collide on the same key.
function directDedupeKey(a, b) {
  return [a, b].sort().join(':')
}

function recipientsOf(participants, exclude) {
  return participants.filter((p) => !p.left_at && p.user_id !== exclude).map((p) => p.user_id)
}

async function insertSystemMessage(c, ctx, conversationId, event, now) {
  return msgRepo.insert(c, {
    appId: ctx.appId, tenantId: ctx.tenantId, conversationId,
    senderUserId: null, type: 'system', body: null, metadata: { event, by: ctx.userId, at: now },
  })
}

// ── create ───────────────────────────────────────────────────────────────
export async function create(ctx, input) {
  const now = new Date().toISOString()
  const type = input.type
  const others = [...new Set((input.participantIds ?? []).filter((id) => id !== ctx.userId))]

  const { conversation, participants, isNew } = await withTenantTransaction(
    ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
      const settings = await resolveSettings(c, ctx.appId, ctx.tenantId)
      if (await banRepo.isBanned(c, ctx.userId)) throw new ForbiddenError('you are banned from chat in this tenant')

      if (type === 'direct') {
        if (others.length !== 1) throw new ValidationError('a direct conversation needs exactly one other participant')
        const other = others[0]
        if (await blockRepo.existsBetween(c, ctx.userId, other)) {
          throw new ConflictError('cannot start a conversation with a blocked user')
        }
        const dedupeKey = directDedupeKey(ctx.userId, other)
        const existing = await convRepo.findByDedupe(c, dedupeKey)
        if (existing) {
          const ps = await partRepo.list(c, existing.id, { includeLeft: true })
          // Re-activate the caller if they had left.
          await partRepo.insert(c, { conversationId: existing.id, userId: ctx.userId, appId: ctx.appId, tenantId: ctx.tenantId, role: 'member' })
          return { conversation: existing, participants: ps, isNew: false }
        }
        // When dm_requests is on, a brand-new direct starts as a pending
        // request until the recipient accepts.
        const conv = await convRepo.insert(c, {
          appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId,
          type, createdBy: ctx.userId, dedupeKey,
          isRequest: !!settings.dm_requests, requestedBy: settings.dm_requests ? ctx.userId : null,
        })
        const ps = []
        ps.push(await partRepo.insert(c, { conversationId: conv.id, userId: ctx.userId, appId: ctx.appId, tenantId: ctx.tenantId, role: 'member' }))
        ps.push(await partRepo.insert(c, { conversationId: conv.id, userId: other, appId: ctx.appId, tenantId: ctx.tenantId, role: 'member' }))
        return { conversation: conv, participants: ps, isNew: true }
      }

      if (type === 'group') {
        if (!settings.allow_groups) throw new ConflictError('group conversations are disabled for this tenant')
        if (!input.title) throw new ValidationError('group conversations require a title')
        const members = [ctx.userId, ...others]
        if (members.length > settings.max_group_size) {
          throw new ValidationError(`group exceeds max size (${settings.max_group_size})`)
        }
        const conv = await convRepo.insert(c, {
          appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId,
          type, title: input.title, topic: input.topic, avatarObjectId: input.avatarObjectId,
          createdBy: ctx.userId, isPublic: !!input.isPublic,
        })
        const ps = []
        ps.push(await partRepo.insert(c, { conversationId: conv.id, userId: ctx.userId, appId: ctx.appId, tenantId: ctx.tenantId, role: 'owner' }))
        for (const u of others) {
          ps.push(await partRepo.insert(c, { conversationId: conv.id, userId: u, appId: ctx.appId, tenantId: ctx.tenantId, role: 'member' }))
        }
        return { conversation: conv, participants: ps, isNew: true }
      }

      if (type === 'support') {
        if (!settings.support_enabled) throw new ConflictError('support conversations are disabled for this tenant')
        const conv = await convRepo.insert(c, {
          appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId,
          type, subject: input.subject, createdBy: ctx.userId,
          supportStatus: 'open', priority: input.priority ?? 'normal',
        })
        const ps = []
        ps.push(await partRepo.insert(c, { conversationId: conv.id, userId: ctx.userId, appId: ctx.appId, tenantId: ctx.tenantId, role: 'member' }))
        // Agents may be added later via /assign; any extra participant ids
        // passed in are added as agents.
        for (const u of others) {
          ps.push(await partRepo.insert(c, { conversationId: conv.id, userId: u, appId: ctx.appId, tenantId: ctx.tenantId, role: 'agent' }))
        }
        // Auto first-response: drop a canned acknowledgement into the ticket so
        // the member gets an immediate reply (chat.md §21). Configured per tenant
        // via settings.support_auto_reply; null = off.
        if (settings.support_auto_reply) {
          const ack = await msgRepo.insert(c, {
            appId: ctx.appId, tenantId: ctx.tenantId, conversationId: conv.id,
            senderUserId: null, type: 'system', body: settings.support_auto_reply,
            metadata: { event: 'support.auto_reply' },
          })
          await convRepo.bumpLastMessageAt(c, conv.id, ack.created_at)
        }
        return { conversation: conv, participants: ps, isNew: true }
      }

      throw new ValidationError(`unknown conversation type: ${type}`)
    },
  )

  if (isNew) {
    const recipients = recipientsOf(participants, ctx.userId)
    await realtime.notify('chat.conversation.created', {
      appId: ctx.appId, tenantId: ctx.tenantId, conversationId: conversation.id,
      type: conversation.type, createdBy: ctx.userId, recipientUserIds: recipients,
    })
    await realtime.emit(ctx, recipients, {
      conversationId: conversation.id, type: 'participant.changed',
      payload: { event: 'created', conversation },
    })
  }
  return { ...conversation, participants }
}

// ── reads ──────────────────────────────────────────────────────────────
export async function get(ctx, id) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureParticipant(me, ctx)
    const participants = await partRepo.list(c, id)
    return { ...conv, participants }
  })
}

export async function list(ctx, filters) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    convRepo.listForUser(c, ctx.userId, filters),
  )
}

export async function listParticipants(ctx, id) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, conv.id, ctx.userId)
    ensureParticipant(me, ctx)
    return partRepo.list(c, id)
  })
}

// ── update (rename / topic / archive) ────────────────────────────────────
export async function update(ctx, id, fields) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureManager(me, ctx)
    const updated = await convRepo.update(c, id, {
      title: fields.title, topic: fields.topic, status: fields.status,
    })
    const participants = await partRepo.list(c, id)
    return { updated, recipients: recipientsOf(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId: id, type: 'participant.changed', payload: { event: 'updated', conversation: result.updated },
  })
  return result.updated
}

// ── leave ────────────────────────────────────────────────────────────────
export async function leave(ctx, id) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureParticipant(me, ctx)
    const now = new Date().toISOString()
    await partRepo.leave(c, id, ctx.userId, now)
    await insertSystemMessage(c, ctx, id, 'participant.left', now)
    const participants = await partRepo.list(c, id)
    return { conv, recipients: participants.map((p) => p.user_id) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId: id, type: 'participant.changed', payload: { event: 'left', userId: ctx.userId },
  })
}

// ── add participants ──────────────────────────────────────────────────────
export async function addParticipants(ctx, id, userIds, role = 'member') {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    if (conv.type === 'direct') throw new ConflictError('cannot add participants to a direct conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureManager(me, ctx)
    const settings = await resolveSettings(c, ctx.appId, ctx.tenantId)
    const current = await partRepo.countActive(c, id)
    const toAdd = [...new Set(userIds)]
    if (current + toAdd.length > settings.max_group_size) {
      throw new ValidationError(`group exceeds max size (${settings.max_group_size})`)
    }
    const now = new Date().toISOString()
    const added = []
    for (const u of toAdd) {
      added.push(await partRepo.insert(c, { conversationId: id, userId: u, appId: ctx.appId, tenantId: ctx.tenantId, role }))
    }
    await insertSystemMessage(c, ctx, id, 'participants.added', now)
    const participants = await partRepo.list(c, id)
    return { added, recipients: participants.map((p) => p.user_id) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId: id, type: 'participant.changed', payload: { event: 'added', participants: result.added },
  })
  await realtime.notify('chat.conversation.created', {
    appId: ctx.appId, tenantId: ctx.tenantId, conversationId: id, recipientUserIds: result.added.map((p) => p.user_id),
  })
  return result.added
}

// ── update a participant (role / mute / notify pref) ──────────────────────
export async function updateParticipant(ctx, id, targetUserId, fields) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    const isSelf = targetUserId === ctx.userId
    // Changing someone's role requires manager/staff; muting/notify-pref can
    // only be changed for yourself.
    if (fields.role !== undefined) {
      ensureManager(me, ctx)
      if (!MANAGER_ROLES.has(fields.role) && fields.role !== 'member' && fields.role !== 'agent') {
        throw new ValidationError('invalid participant role')
      }
    }
    if ((fields.mutedUntil !== undefined || fields.notifyPref !== undefined) && !isSelf && !isStaff(ctx)) {
      throw new ConflictError('can only change mute/notify preferences for yourself')
    }
    const updated = ensureFound(await partRepo.update(c, id, targetUserId, {
      role: fields.role, muted_until: fields.mutedUntil, notify_pref: fields.notifyPref,
    }), 'Participant')
    return updated
  })
}

// ── remove participant ────────────────────────────────────────────────────
export async function removeParticipant(ctx, id, targetUserId) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    if (conv.type === 'direct') throw new ConflictError('cannot remove participants from a direct conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureManager(me, ctx)
    const now = new Date().toISOString()
    const removed = ensureFound(await partRepo.leave(c, id, targetUserId, now), 'Participant')
    await insertSystemMessage(c, ctx, id, 'participant.removed', now)
    const participants = await partRepo.list(c, id)
    return { removed, recipients: [...participants.map((p) => p.user_id), targetUserId] }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId: id, type: 'participant.changed', payload: { event: 'removed', userId: targetUserId },
  })
}

// ── DM requests (accept / decline) ──────────────────────────────────────────
export async function acceptRequest(ctx, id) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureParticipant(me, ctx)
    if (!conv.is_request) return conv
    if (conv.requested_by === ctx.userId) throw new ConflictError('the requester cannot accept their own request')
    return convRepo.update(c, id, { is_request: false, requested_by: null })
  })
}

export async function declineRequest(ctx, id) {
  await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureParticipant(me, ctx)
    if (!conv.is_request) throw new ConflictError('conversation is not a pending request')
    // Decline = the recipient leaves and the request is archived.
    await partRepo.leave(c, id, ctx.userId, new Date().toISOString())
    await convRepo.update(c, id, { status: 'archived' })
  })
}

// ── invites ────────────────────────────────────────────────────────────────
export async function createInvite(ctx, id, input) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    if (conv.type === 'direct') throw new ConflictError('cannot create invites for a direct conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureManager(me, ctx)
    return inviteRepo.insert(c, {
      appId: ctx.appId, tenantId: ctx.tenantId, conversationId: id, code: newInviteCode(),
      createdBy: ctx.userId, role: input.role ?? 'member', maxUses: input.maxUses, expiresAt: input.expiresAt,
    })
  })
}

export async function listInvites(ctx, id) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureManager(me, ctx)
    return inviteRepo.listForConversation(c, id)
  })
}

export async function revokeInvite(ctx, id, inviteId) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, id), 'Conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    ensureManager(me, ctx)
    return ensureFound(await inviteRepo.revoke(c, inviteId), 'Invite')
  })
}

export async function joinByCode(ctx, code) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    if (await banRepo.isBanned(c, ctx.userId)) throw new ForbiddenError('you are banned from chat in this tenant')
    const invite = ensureFound(await inviteRepo.findByCode(c, code), 'Invite')
    if (invite.revoked_at) throw new ConflictError('invite revoked')
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) throw new ConflictError('invite expired')
    if (invite.max_uses != null && invite.uses >= invite.max_uses) throw new ConflictError('invite exhausted')
    const conv = ensureFound(await convRepo.findById(c, invite.conversation_id), 'Conversation')
    await partRepo.insert(c, { conversationId: conv.id, userId: ctx.userId, appId: ctx.appId, tenantId: ctx.tenantId, role: invite.role })
    await inviteRepo.incrementUses(c, invite.id)
    await insertSystemMessage(c, ctx, conv.id, 'participant.joined', new Date().toISOString())
    const participants = await partRepo.list(c, conv.id)
    return { conv, recipients: participants.map((p) => p.user_id) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId: result.conv.id, type: 'participant.changed', payload: { event: 'joined', userId: ctx.userId },
  })
  return result.conv
}

// ── public groups ────────────────────────────────────────────────────────────
export async function listPublic(ctx, opts) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) => convRepo.listPublic(c, opts))
}

export async function joinPublic(ctx, id) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    if (await banRepo.isBanned(c, ctx.userId)) throw new ForbiddenError('you are banned from chat in this tenant')
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    if (conv.type !== 'group' || !conv.is_public || conv.status !== 'active') {
      throw new ConflictError('conversation is not a joinable public group')
    }
    await partRepo.insert(c, { conversationId: id, userId: ctx.userId, appId: ctx.appId, tenantId: ctx.tenantId, role: 'member' })
    await insertSystemMessage(c, ctx, id, 'participant.joined', new Date().toISOString())
    const participants = await partRepo.list(c, id)
    return { conv, recipients: participants.map((p) => p.user_id) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId: id, type: 'participant.changed', payload: { event: 'joined', userId: ctx.userId },
  })
  return result.conv
}

// ── support queue routing ──────────────────────────────────────────────────
export async function setQueue(ctx, id, queue) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
    if (conv.type !== 'support') throw new ConflictError('not a support conversation')
    const me = await partRepo.find(c, id, ctx.userId)
    if (!isStaff(ctx)) ensureManager(me, ctx)
    return convRepo.update(c, id, { queue })
  })
}

// Internal: load a conversation + the caller's participant row (used by other
// services that need access checks against the same tenant transaction).
export async function loadForAccess(c, ctx, id) {
  const conv = ensureFound(await convRepo.findById(c, id), 'Conversation')
  const me = await partRepo.find(c, id, ctx.userId)
  return { conv, me }
}
