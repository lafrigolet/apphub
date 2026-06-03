import { z } from 'zod'
import * as convService from '../services/conversations.service.js'
import * as msgService from '../services/messages.service.js'

const uuid = z.string().uuid()

const createConvBody = z.object({
  type:            z.enum(['direct', 'group', 'support']),
  participantIds:  z.array(uuid).max(512).optional(),
  title:           z.string().min(1).max(200).optional(),
  topic:           z.string().max(500).optional(),
  avatarObjectId:  uuid.optional(),
  isPublic:        z.boolean().optional(),
  subject:         z.string().max(200).optional(),
  priority:        z.enum(['low', 'normal', 'high', 'urgent']).optional(),
})

const listConvQuery = z.object({
  type:   z.enum(['direct', 'group', 'support']).optional(),
  status: z.enum(['active', 'archived']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
})

const updateConvBody = z.object({
  title:  z.string().min(1).max(200).optional(),
  topic:  z.string().max(500).optional().nullable(),
  status: z.enum(['active', 'archived']).optional(),
})

const addParticipantsBody = z.object({
  userIds: z.array(uuid).min(1).max(256),
  role:    z.enum(['member', 'admin', 'agent']).default('member'),
})

const updateParticipantBody = z.object({
  role:       z.enum(['owner', 'admin', 'member', 'agent']).optional(),
  mutedUntil: z.string().datetime().optional().nullable(),
  notifyPref: z.enum(['all', 'mentions', 'none']).optional(),
})

const listMessagesQuery = z.object({
  before: uuid.optional(),
  after:  uuid.optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
})

const postMessageBody = z.object({
  body:             z.string().min(1).max(8000).optional(),
  type:             z.enum(['text', 'attachment']).optional(),
  replyToMessageId: uuid.optional(),
  threadRootId:     uuid.optional(),
  mentions:         z.array(uuid).max(128).optional(),
  mentionScope:     z.enum(['all', 'here']).optional(),
  mentionRoles:     z.array(z.enum(['owner', 'admin', 'member', 'agent'])).optional(),
  mentionAppRoles:  z.array(z.string().max(32)).max(8).optional(),
  scheduledFor:     z.string().datetime().optional(),
  expiresAt:        z.string().datetime().optional(),
})

const editMessageBody = z.object({ body: z.string().min(1).max(8000) })
const readBody = z.object({ lastReadMessageId: uuid.optional() })
const deliveredBody = z.object({ lastDeliveredMessageId: uuid.optional() })
const forwardBody = z.object({ toConversationId: uuid })
const createInviteBody = z.object({
  role:      z.enum(['member', 'admin']).default('member'),
  maxUses:   z.coerce.number().int().min(1).max(100000).optional(),
  expiresAt: z.string().datetime().optional(),
})
const threadQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) })
const publicQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
const attachBody = z.object({
  objectId:     uuid,
  kind:         z.enum(['image', 'video', 'file']),
  displayOrder: z.coerce.number().int().min(0).optional(),
})

const TAG = ['chat']

export async function memberRoutes(fastify) {
  const ctx = (req) => req.identity
  const bearer = (req) => {
    const h = req.headers.authorization
    return h?.startsWith('Bearer ') ? h.slice(7) : undefined
  }

  // ── conversations ──────────────────────────────────────────────────────
  fastify.post('/conversations', {
    schema: { tags: TAG, summary: 'Create a conversation (direct / group / support)', body: createConvBody },
  }, async (req, reply) => {
    const body = createConvBody.parse(req.body ?? {})
    const data = await convService.create(ctx(req), body)
    reply.code(201)
    return { data }
  })

  fastify.get('/conversations', {
    schema: { tags: TAG, summary: 'List my conversations with unread counts', querystring: listConvQuery },
  }, async (req) => {
    const q = listConvQuery.parse(req.query ?? {})
    return { data: await convService.list(ctx(req), q) }
  })

  fastify.get('/conversations/:id', {
    schema: { tags: TAG, summary: 'Get one conversation (participants only)' },
  }, async (req) => ({ data: await convService.get(ctx(req), req.params.id) }))

  fastify.patch('/conversations/:id', {
    schema: { tags: TAG, summary: 'Rename / set topic / archive (owner/admin)', body: updateConvBody },
  }, async (req) => {
    const body = updateConvBody.parse(req.body ?? {})
    return { data: await convService.update(ctx(req), req.params.id, body) }
  })

  fastify.post('/conversations/:id/leave', {
    schema: { tags: TAG, summary: 'Leave a conversation' },
  }, async (req) => {
    await convService.leave(ctx(req), req.params.id)
    return { data: { ok: true } }
  })

  // ── participants ─────────────────────────────────────────────────────────
  fastify.get('/conversations/:id/participants', {
    schema: { tags: TAG, summary: 'List participants' },
  }, async (req) => ({ data: await convService.listParticipants(ctx(req), req.params.id) }))

  fastify.post('/conversations/:id/participants', {
    schema: { tags: TAG, summary: 'Add participants (owner/admin)', body: addParticipantsBody },
  }, async (req, reply) => {
    const body = addParticipantsBody.parse(req.body ?? {})
    const data = await convService.addParticipants(ctx(req), req.params.id, body.userIds, body.role)
    reply.code(201)
    return { data }
  })

  fastify.patch('/conversations/:id/participants/:userId', {
    schema: { tags: TAG, summary: 'Change role / mute / notify pref', body: updateParticipantBody },
  }, async (req) => {
    const body = updateParticipantBody.parse(req.body ?? {})
    return { data: await convService.updateParticipant(ctx(req), req.params.id, req.params.userId, body) }
  })

  fastify.delete('/conversations/:id/participants/:userId', {
    schema: { tags: TAG, summary: 'Remove a participant (owner/admin)' },
  }, async (req) => {
    await convService.removeParticipant(ctx(req), req.params.id, req.params.userId)
    return { data: { ok: true } }
  })

  // ── messages ──────────────────────────────────────────────────────────────
  fastify.get('/conversations/:id/messages', {
    schema: { tags: TAG, summary: 'List messages (cursor paginated)', querystring: listMessagesQuery },
  }, async (req) => {
    const q = listMessagesQuery.parse(req.query ?? {})
    return { data: await msgService.listMessages(ctx(req), req.params.id, q) }
  })

  fastify.post('/conversations/:id/messages', {
    schema: { tags: TAG, summary: 'Post a message (supports threads, scheduling, ephemeral, mentions)', body: postMessageBody },
  }, async (req, reply) => {
    const body = postMessageBody.parse(req.body ?? {})
    const data = await msgService.postMessage(ctx(req), req.params.id, body, { bearerToken: bearer(req) })
    reply.code(201)
    return { data }
  })

  fastify.post('/conversations/:id/messages/:mid/forward', {
    schema: { tags: TAG, summary: 'Forward a message to another conversation', body: forwardBody },
  }, async (req, reply) => {
    const body = forwardBody.parse(req.body ?? {})
    const data = await msgService.forward(ctx(req), req.params.id, req.params.mid, body.toConversationId)
    reply.code(201)
    return { data }
  })

  fastify.get('/conversations/:id/messages/:mid/thread', {
    schema: { tags: TAG, summary: 'List a thread (root + replies)', querystring: threadQuery },
  }, async (req) => {
    const q = threadQuery.parse(req.query ?? {})
    return { data: await msgService.listThread(ctx(req), req.params.id, req.params.mid, q) }
  })

  fastify.patch('/conversations/:id/messages/:mid', {
    schema: { tags: TAG, summary: 'Edit your own message', body: editMessageBody },
  }, async (req) => {
    const body = editMessageBody.parse(req.body ?? {})
    return { data: await msgService.editMessage(ctx(req), req.params.id, req.params.mid, body.body) }
  })

  fastify.delete('/conversations/:id/messages/:mid', {
    schema: { tags: TAG, summary: 'Soft-delete a message (sender or admin)' },
  }, async (req) => ({ data: await msgService.deleteMessage(ctx(req), req.params.id, req.params.mid) }))

  fastify.post('/conversations/:id/read', {
    schema: { tags: TAG, summary: 'Set the last-read marker', body: readBody },
  }, async (req) => {
    const body = readBody.parse(req.body ?? {})
    return { data: await msgService.markRead(ctx(req), req.params.id, body.lastReadMessageId) }
  })

  fastify.post('/conversations/:id/delivered', {
    schema: { tags: TAG, summary: 'Set the last-delivered marker', body: deliveredBody },
  }, async (req) => {
    const body = deliveredBody.parse(req.body ?? {})
    return { data: await msgService.markDelivered(ctx(req), req.params.id, body.lastDeliveredMessageId) }
  })

  fastify.get('/unread', {
    schema: { tags: TAG, summary: 'Global unread summary across my conversations' },
  }, async (req) => ({ data: await msgService.unread(ctx(req)) }))

  // ── pins ───────────────────────────────────────────────────────────────────
  fastify.put('/conversations/:id/messages/:mid/pin', {
    schema: { tags: TAG, summary: 'Pin a message' },
  }, async (req, reply) => {
    await msgService.pin(ctx(req), req.params.id, req.params.mid)
    reply.code(201)
    return { data: { ok: true } }
  })

  fastify.delete('/conversations/:id/messages/:mid/pin', {
    schema: { tags: TAG, summary: 'Unpin a message' },
  }, async (req) => {
    await msgService.unpin(ctx(req), req.params.id, req.params.mid)
    return { data: { ok: true } }
  })

  fastify.get('/conversations/:id/pins', {
    schema: { tags: TAG, summary: 'List pinned messages' },
  }, async (req) => ({ data: await msgService.listPins(ctx(req), req.params.id) }))

  // ── DM requests ──────────────────────────────────────────────────────────────
  fastify.post('/conversations/:id/accept', {
    schema: { tags: TAG, summary: 'Accept a pending direct-message request' },
  }, async (req) => ({ data: await convService.acceptRequest(ctx(req), req.params.id) }))

  fastify.post('/conversations/:id/decline', {
    schema: { tags: TAG, summary: 'Decline a pending direct-message request' },
  }, async (req) => {
    await convService.declineRequest(ctx(req), req.params.id)
    return { data: { ok: true } }
  })

  // ── invites ────────────────────────────────────────────────────────────────
  fastify.post('/conversations/:id/invites', {
    schema: { tags: TAG, summary: 'Create an invite code (owner/admin)', body: createInviteBody },
  }, async (req, reply) => {
    const body = createInviteBody.parse(req.body ?? {})
    const data = await convService.createInvite(ctx(req), req.params.id, body)
    reply.code(201)
    return { data }
  })

  fastify.get('/conversations/:id/invites', {
    schema: { tags: TAG, summary: 'List invite codes (owner/admin)' },
  }, async (req) => ({ data: await convService.listInvites(ctx(req), req.params.id) }))

  fastify.delete('/conversations/:id/invites/:inviteId', {
    schema: { tags: TAG, summary: 'Revoke an invite code (owner/admin)' },
  }, async (req) => ({ data: await convService.revokeInvite(ctx(req), req.params.id, req.params.inviteId) }))

  fastify.post('/invites/:code/join', {
    schema: { tags: TAG, summary: 'Join a conversation by invite code' },
  }, async (req) => ({ data: await convService.joinByCode(ctx(req), req.params.code) }))

  // ── public groups ────────────────────────────────────────────────────────────
  fastify.get('/public/conversations', {
    schema: { tags: TAG, summary: 'List public discoverable groups', querystring: publicQuery },
  }, async (req) => {
    const q = publicQuery.parse(req.query ?? {})
    return { data: await convService.listPublic(ctx(req), q) }
  })

  fastify.post('/public/conversations/:id/join', {
    schema: { tags: TAG, summary: 'Join a public group' },
  }, async (req) => ({ data: await convService.joinPublic(ctx(req), req.params.id) }))

  // ── reactions ──────────────────────────────────────────────────────────────
  fastify.put('/conversations/:id/messages/:mid/reactions/:emoji', {
    schema: { tags: TAG, summary: 'Add my reaction to a message' },
  }, async (req) => ({ data: await msgService.addReaction(ctx(req), req.params.id, req.params.mid, req.params.emoji) }))

  fastify.delete('/conversations/:id/messages/:mid/reactions/:emoji', {
    schema: { tags: TAG, summary: 'Remove my reaction from a message' },
  }, async (req) => ({ data: await msgService.removeReaction(ctx(req), req.params.id, req.params.mid, req.params.emoji) }))

  // ── attachments (storage-backed) ─────────────────────────────────────────────
  fastify.post('/conversations/:id/messages/:mid/attachments', {
    schema: { tags: TAG, summary: 'Link a finalized storage object to a message', body: attachBody },
  }, async (req, reply) => {
    const body = attachBody.parse(req.body ?? {})
    const data = await msgService.attach(ctx(req), req.params.id, req.params.mid, body)
    reply.code(201)
    return { data }
  })

  fastify.get('/conversations/:id/messages/:mid/attachments', {
    schema: { tags: TAG, summary: 'List a message\'s attachments' },
  }, async (req) => ({ data: await msgService.listAttachments(ctx(req), req.params.id, req.params.mid) }))

  fastify.delete('/conversations/:id/messages/:mid/attachments/:attId', {
    schema: { tags: TAG, summary: 'Unlink an attachment (sender or staff)' },
  }, async (req) => {
    await msgService.detach(ctx(req), req.params.id, req.params.mid, req.params.attId)
    return { data: { ok: true } }
  })
}
