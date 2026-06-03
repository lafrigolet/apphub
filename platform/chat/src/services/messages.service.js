import { withTenantTransaction } from '../lib/db.js'
import { ValidationError, ForbiddenError } from '@apphub/platform-sdk/errors'
import { redactPii } from '../lib/redact.js'
import { enforceRate } from '../lib/ratelimit.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as convRepo from '../repositories/conversations.repository.js'
import * as reactionRepo from '../repositories/reactions.repository.js'
import * as attachmentRepo from '../repositories/attachments.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as pinRepo from '../repositories/pins.repository.js'
import * as realtime from './realtime.service.js'
import * as mentions from './mentions.service.js'
import { resolve as resolveSettings } from './settings.service.js'
import { ensureParticipant, ensureFound, isStaff, MANAGER_ROLES } from './guards.js'

// Reject content containing tenant-banned words.
function assertNoBannedWords(body, settings) {
  const words = settings.banned_words ?? []
  if (!body || !words.length) return
  const lower = body.toLowerCase()
  if (words.some((w) => w && lower.includes(String(w).toLowerCase()))) {
    throw new ValidationError('message contains banned content')
  }
}

const RATE_MAX = 30        // messages
const RATE_WINDOW = 10     // seconds

function activeRecipients(participants, excludeUserId) {
  return participants.filter((p) => !p.left_at && p.user_id !== excludeUserId).map((p) => p.user_id)
}

// ── post ───────────────────────────────────────────────────────────────
// opts.bearerToken is forwarded for app-role mention resolution (@staff).
export async function postMessage(ctx, conversationId, input, opts = {}) {
  if (!input.body && !(input.type === 'attachment')) {
    throw new ValidationError('message body is required')
  }
  await enforceRate(`chat:rate:${ctx.appId}:${ctx.tenantId}:${ctx.userId}`, RATE_MAX, RATE_WINDOW)

  // A future scheduled_for parks the message as 'scheduled'; it stays hidden
  // until platform-scheduler fires chat.scheduled.due → deliverScheduled().
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null
  const isScheduled = scheduledFor && scheduledFor.getTime() > Date.now()

  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    if (conv.status === 'archived') throw new ForbiddenError('conversation is archived')
    if (await banRepo.isBanned(c, ctx.userId)) throw new ForbiddenError('you are banned from chat in this tenant')

    const settings = await resolveSettings(c, ctx.appId, ctx.tenantId)
    assertNoBannedWords(input.body, settings)
    const body = settings.redaction_enabled ? redactPii(input.body) : input.body

    const participants = await partRepo.list(c, conversationId)
    const mentioned = await mentions.resolve({ ctx, participants, input, bearerToken: opts.bearerToken })

    const message = await msgRepo.insert(c, {
      appId: ctx.appId, tenantId: ctx.tenantId, conversationId,
      senderUserId: ctx.userId, type: input.type ?? 'text', body,
      replyToMessageId: input.replyToMessageId, threadRootId: input.threadRootId,
      status: isScheduled ? 'scheduled' : 'sent',
      scheduledFor: isScheduled ? scheduledFor.toISOString() : null,
      expiresAt: input.expiresAt ?? null,
      // Stash mentions on scheduled rows so deliverScheduledFor can persist them.
      metadata: isScheduled && mentioned.length ? { mentions: mentioned } : {},
    })

    if (mentioned.length && !isScheduled) await msgRepo.insertMentions(c, message, mentioned)
    if (!isScheduled) await convRepo.bumpLastMessageAt(c, conversationId, message.created_at)
    return { message, recipients: activeRecipients(participants, ctx.userId), mentioned, isScheduled }
  })

  // Scheduled messages are silent until delivery — no fan-out yet.
  if (result.isScheduled) return result.message

  await emitCreated(ctx, conversationId, result.message, result.recipients, result.mentioned)
  return result.message
}

// Shared fan-out for a freshly-live message (used by postMessage + deliverScheduled).
async function emitCreated(ctx, conversationId, message, recipients, mentioned) {
  await realtime.emit(ctx, recipients, {
    conversationId, type: 'message.created', payload: { message },
  })
  await realtime.notify('chat.message.created', {
    appId: ctx.appId, tenantId: ctx.tenantId, conversationId,
    messageId: message.id, senderUserId: ctx.userId, recipientUserIds: recipients,
  })
  for (const u of mentioned ?? []) {
    await realtime.notify('chat.mention.created', {
      appId: ctx.appId, tenantId: ctx.tenantId, conversationId,
      messageId: message.id, mentionedUserId: u, senderUserId: ctx.userId,
    })
  }
}

// Called by the chat event consumer when platform-scheduler signals a scheduled
// message is due. The scheduler event carries appId/tenantId so we run in the
// right RLS scope (there is no JWT in a cron-driven flow).
export async function deliverScheduledFor({ appId, tenantId, subTenantId, messageId }) {
  const result = await withTenantTransaction(appId, tenantId, subTenantId ?? null, async (c) => {
    const message = await msgRepo.deliverScheduled(c, messageId, new Date().toISOString())
    if (!message) return null
    const participants = await partRepo.list(c, message.conversation_id)
    const participantIds = new Set(participants.map((p) => p.user_id))
    // Persist any mentions stashed in metadata at schedule time.
    const stashed = (message.metadata?.mentions ?? []).filter((u) => participantIds.has(u))
    if (stashed.length) await msgRepo.insertMentions(c, message, stashed)
    await convRepo.bumpLastMessageAt(c, message.conversation_id, message.created_at)
    return { message, recipients: activeRecipients(participants, message.sender_user_id), mentioned: stashed }
  })
  if (!result) return null
  const ctx = { appId, tenantId, subTenantId: subTenantId ?? null, userId: result.message.sender_user_id }
  await emitCreated(ctx, result.message.conversation_id, result.message, result.recipients, result.mentioned)
  return result.message
}

// ── list history ──────────────────────────────────────────────────────────
export async function listMessages(ctx, conversationId, opts) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    return msgRepo.list(c, conversationId, opts)
  })
}

// ── edit ────────────────────────────────────────────────────────────────
export async function editMessage(ctx, conversationId, messageId, body) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    const existing = ensureFound(await msgRepo.findById(c, messageId), 'Message')
    if (existing.conversation_id !== conversationId) throw ensureFound(null, 'Message')
    if (existing.sender_user_id !== ctx.userId) throw new ForbiddenError('can only edit your own message')
    const settings = await resolveSettings(c, ctx.appId, ctx.tenantId)
    const safe = settings.redaction_enabled ? redactPii(body) : body
    const updated = ensureFound(await msgRepo.updateBody(c, messageId, safe, new Date().toISOString()), 'Message')
    const participants = await partRepo.list(c, conversationId)
    return { updated, recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'message.updated', payload: { message: result.updated },
  })
  return result.updated
}

// ── delete (soft) ──────────────────────────────────────────────────────────
export async function deleteMessage(ctx, conversationId, messageId) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    const existing = ensureFound(await msgRepo.findById(c, messageId), 'Message')
    if (existing.conversation_id !== conversationId) throw ensureFound(null, 'Message')
    const isOwnerOfMsg = existing.sender_user_id === ctx.userId
    const canModerate = isStaff(ctx) || (me && MANAGER_ROLES.has(me.role))
    if (!isOwnerOfMsg && !canModerate) throw new ForbiddenError('cannot delete this message')
    const deleted = ensureFound(await msgRepo.softDelete(c, messageId, new Date().toISOString()), 'Message')
    const participants = await partRepo.list(c, conversationId)
    return { deleted, recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'message.deleted', payload: { messageId },
  })
  return result.deleted
}

// ── read marker ────────────────────────────────────────────────────────────
export async function markRead(ctx, conversationId, lastReadMessageId) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    const updated = ensureFound(
      await partRepo.setLastRead(c, conversationId, ctx.userId, lastReadMessageId ?? null, new Date().toISOString()),
      'Participant',
    )
    const participants = await partRepo.list(c, conversationId)
    return { updated, recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'read.updated',
    payload: { userId: ctx.userId, lastReadMessageId, lastReadAt: result.updated.last_read_at },
  })
  return result.updated
}

export async function unread(ctx) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    msgRepo.unreadSummary(c, ctx.userId),
  )
}

// ── reactions ──────────────────────────────────────────────────────────────
async function loadMessageWithAccess(c, ctx, conversationId, messageId) {
  ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
  const me = await partRepo.find(c, conversationId, ctx.userId)
  ensureParticipant(me, ctx)
  const message = ensureFound(await msgRepo.findById(c, messageId), 'Message')
  if (message.conversation_id !== conversationId) throw ensureFound(null, 'Message')
  const participants = await partRepo.list(c, conversationId)
  return { me, message, participants }
}

export async function addReaction(ctx, conversationId, messageId, emoji) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const { participants } = await loadMessageWithAccess(c, ctx, conversationId, messageId)
    await reactionRepo.add(c, { messageId, userId: ctx.userId, emoji, appId: ctx.appId, tenantId: ctx.tenantId })
    const reactions = await reactionRepo.listForMessage(c, messageId)
    return { reactions, recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'reaction.changed', payload: { messageId, reactions: result.reactions },
  })
  return result.reactions
}

export async function removeReaction(ctx, conversationId, messageId, emoji) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const { participants } = await loadMessageWithAccess(c, ctx, conversationId, messageId)
    await reactionRepo.remove(c, messageId, ctx.userId, emoji)
    const reactions = await reactionRepo.listForMessage(c, messageId)
    return { reactions, recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'reaction.changed', payload: { messageId, reactions: result.reactions },
  })
  return result.reactions
}

// ── attachments (storage-backed) ────────────────────────────────────────────
export async function attach(ctx, conversationId, messageId, input) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const { message, participants } = await loadMessageWithAccess(c, ctx, conversationId, messageId)
    if (message.sender_user_id !== ctx.userId && !isStaff(ctx)) {
      throw new ForbiddenError('only the message sender can attach to it')
    }
    // Per-tenant kind allow-list (null = all kinds allowed). Size limits are
    // enforced at the storage layer; max_attachment_mb is advisory metadata.
    const settings = await resolveSettings(c, ctx.appId, ctx.tenantId)
    if (settings.allowed_attachment_kinds && !settings.allowed_attachment_kinds.includes(input.kind)) {
      throw new ValidationError(`attachment kind '${input.kind}' not allowed for this tenant`)
    }
    const att = await attachmentRepo.insert(c, {
      appId: ctx.appId, tenantId: ctx.tenantId, messageId,
      objectId: input.objectId, kind: input.kind, displayOrder: input.displayOrder,
    })
    return { att, recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'message.updated', payload: { messageId, attachment: result.att },
  })
  return result.att
}

export async function listAttachments(ctx, conversationId, messageId) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    await loadMessageWithAccess(c, ctx, conversationId, messageId)
    return attachmentRepo.listForMessage(c, messageId)
  })
}

export async function detach(ctx, conversationId, messageId, attachmentId) {
  await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const { message } = await loadMessageWithAccess(c, ctx, conversationId, messageId)
    if (message.sender_user_id !== ctx.userId && !isStaff(ctx)) {
      throw new ForbiddenError('only the message sender can remove its attachments')
    }
    const att = ensureFound(await attachmentRepo.findById(c, attachmentId), 'Attachment')
    if (att.message_id !== messageId) throw ensureFound(null, 'Attachment')
    await attachmentRepo.remove(c, attachmentId)
  })
}

// ── forward ────────────────────────────────────────────────────────────────
export async function forward(ctx, conversationId, messageId, toConversationId) {
  if (toConversationId === conversationId) throw new ValidationError('cannot forward to the same conversation')
  const src = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const { message } = await loadMessageWithAccess(c, ctx, conversationId, messageId)
    if (message.deleted_at) throw new ValidationError('cannot forward a deleted message')
    return message
  })
  // Re-post the body into the target conversation (access to the target is
  // enforced by postMessage). Provenance is carried in the body's metadata.
  return postMessage(ctx, toConversationId, { body: src.body, type: 'text' })
}

// ── threads ──────────────────────────────────────────────────────────────────
export async function listThread(ctx, conversationId, rootMessageId, opts) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    const root = ensureFound(await msgRepo.findById(c, rootMessageId), 'Message')
    if (root.conversation_id !== conversationId) throw ensureFound(null, 'Message')
    return msgRepo.listThread(c, rootMessageId, opts)
  })
}

// ── delivered receipts ─────────────────────────────────────────────────────
export async function markDelivered(ctx, conversationId, lastDeliveredMessageId) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    const updated = ensureFound(
      await partRepo.setDelivered(c, conversationId, ctx.userId, lastDeliveredMessageId ?? null, new Date().toISOString()),
      'Participant',
    )
    const participants = await partRepo.list(c, conversationId)
    return { updated, recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'delivered.updated',
    payload: { userId: ctx.userId, lastDeliveredMessageId, lastDeliveredAt: result.updated.last_delivered_at },
  })
  return result.updated
}

// ── pins ───────────────────────────────────────────────────────────────────
export async function pin(ctx, conversationId, messageId) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const { message, participants } = await loadMessageWithAccess(c, ctx, conversationId, messageId)
    if (message.deleted_at) throw new ValidationError('cannot pin a deleted message')
    await pinRepo.add(c, { conversationId, messageId, appId: ctx.appId, tenantId: ctx.tenantId, pinnedBy: ctx.userId })
    return { recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'pin.changed', payload: { event: 'pinned', messageId, by: ctx.userId },
  })
}

export async function unpin(ctx, conversationId, messageId) {
  const result = await withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    await pinRepo.remove(c, conversationId, messageId)
    const participants = await partRepo.list(c, conversationId)
    return { recipients: activeRecipients(participants, ctx.userId) }
  })
  await realtime.emit(ctx, result.recipients, {
    conversationId, type: 'pin.changed', payload: { event: 'unpinned', messageId, by: ctx.userId },
  })
}

export async function listPins(ctx, conversationId) {
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const me = await partRepo.find(c, conversationId, ctx.userId)
    ensureParticipant(me, ctx)
    return pinRepo.listForConversation(c, conversationId)
  })
}
