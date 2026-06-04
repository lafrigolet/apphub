import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/messaging.repository.js'
import { redactPii } from '../lib/redact.js'
import { ForbiddenError, NotFoundError } from '../utils/errors.js'

function ensureThreadAccess(thread, ctx) {
  if (!thread) throw new NotFoundError('thread')
  const isParty = thread.buyer_user_id === ctx.userId || thread.vendor_user_id === ctx.userId
  if (!isParty && !['staff', 'super_admin'].includes(ctx.role)) {
    throw new ForbiddenError('not a participant of this thread')
  }
}

export async function createThread(ctx, input) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertThread(c, ctx.appId, ctx.tenantId, input),
  )
}

export async function listThreads(ctx, role) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listThreadsForUser(c, ctx.appId, ctx.tenantId, ctx.userId, role),
  )
}

export async function getThread(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const thread = await repo.findThreadById(c, ctx.appId, ctx.tenantId, id)
    ensureThreadAccess(thread, ctx)
    return thread
  })
}

export async function listMessages(ctx, threadId, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const thread = await repo.findThreadById(c, ctx.appId, ctx.tenantId, threadId)
    ensureThreadAccess(thread, ctx)
    return repo.listMessages(c, ctx.appId, ctx.tenantId, threadId, opts)
  })
}

export async function postMessage(ctx, threadId, body, attachments) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const thread = await repo.findThreadById(c, ctx.appId, ctx.tenantId, threadId)
    ensureThreadAccess(thread, ctx)
    // Anti-disintermediation: enmascara emails/teléfonos antes de persistir,
    // para que el cuerpo almacenado (y servido) no filtre datos de contacto.
    const safeBody = redactPii(body)
    const message = await repo.insertMessage(c, ctx.appId, ctx.tenantId, threadId, ctx.userId, safeBody, attachments ?? [])
    const recipientUserId = thread.buyer_user_id === ctx.userId ? thread.vendor_user_id : thread.buyer_user_id
    await publish({
      type: 'message.created',
      payload: {
        messageId: message.id, threadId, appId: ctx.appId, tenantId: ctx.tenantId,
        senderUserId: ctx.userId, recipientUserId, orderId: thread.order_id,
      },
    })
    // Vendor SLA core: stamp the vendor's first reply once. A consumer/scheduler
    // (cross-cutting, pending) can use this to compute response-time metrics and
    // detect SLA breaches.
    if (ctx.userId === thread.vendor_user_id) {
      const isFirst = await repo.recordFirstReply(c, ctx.appId, ctx.tenantId, threadId)
      if (isFirst) {
        await publish({
          type: 'thread.first_reply',
          payload: {
            threadId, appId: ctx.appId, tenantId: ctx.tenantId,
            vendorUserId: thread.vendor_user_id, buyerUserId: thread.buyer_user_id,
            orderId: thread.order_id, messageId: message.id,
          },
        })
      }
    }
    return message
  })
}

export async function markRead(ctx, threadId, messageId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const thread = await repo.findThreadById(c, ctx.appId, ctx.tenantId, threadId)
    ensureThreadAccess(thread, ctx)
    const ok = await repo.markRead(c, ctx.appId, ctx.tenantId, messageId)
    if (!ok) throw new NotFoundError('message')
  })
}

// Mark every message in the thread (not sent by the reader) as read. Idempotent;
// returns { marked } with the count newly flipped. Emits `thread.read` once when
// something actually changed so an inbox-badge consumer can refresh.
export async function markThreadRead(ctx, threadId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const thread = await repo.findThreadById(c, ctx.appId, ctx.tenantId, threadId)
    ensureThreadAccess(thread, ctx)
    const marked = await repo.markThreadRead(c, ctx.appId, ctx.tenantId, threadId, ctx.userId)
    if (marked > 0) {
      await publish({
        type: 'thread.read',
        payload: {
          threadId, appId: ctx.appId, tenantId: ctx.tenantId,
          readerUserId: ctx.userId, marked,
        },
      })
    }
    return { marked }
  })
}

// Unread count for a single thread (messages addressed to the current user).
export async function getThreadUnreadCount(ctx, threadId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const thread = await repo.findThreadById(c, ctx.appId, ctx.tenantId, threadId)
    ensureThreadAccess(thread, ctx)
    const unread = await repo.countUnreadInThread(c, ctx.appId, ctx.tenantId, threadId, ctx.userId)
    return { threadId, unread }
  })
}

// Unread counts across all the current user's threads, for an inbox badge.
// No per-thread access check needed: the query is already scoped to threads the
// user participates in (and to the tenant via RLS + WHERE).
export async function getUnreadCounts(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const rows = await repo.unreadCountsByThread(c, ctx.appId, ctx.tenantId, ctx.userId)
    const byThread = rows.map((r) => ({ threadId: r.thread_id, unread: r.unread }))
    const total = byThread.reduce((s, r) => s + r.unread, 0)
    return { total, threads: byThread }
  })
}

// ── Storage-backed attachments ──────────────────────────────────────────

async function ensureMessageAccess(ctx, threadId, messageId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const thread = await repo.findThreadById(c, ctx.appId, ctx.tenantId, threadId)
    ensureThreadAccess(thread, ctx)
    const message = await repo.findMessageById(c, ctx.appId, ctx.tenantId, messageId)
    if (!message || message.thread_id !== threadId) throw new NotFoundError('message')
    return { thread, message }
  })
}

export async function attachToMessage(ctx, threadId, messageId, body) {
  await ensureMessageAccess(ctx, threadId, messageId)
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertAttachment(c, ctx.appId, ctx.tenantId, messageId, body),
  )
}

export async function listMessageAttachments(ctx, threadId, messageId) {
  await ensureMessageAccess(ctx, threadId, messageId)
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listAttachments(c, ctx.appId, ctx.tenantId, messageId),
  )
}

export async function detachFromMessage(ctx, threadId, messageId, attachmentId) {
  const { message } = await ensureMessageAccess(ctx, threadId, messageId)
  // Only the original sender (or staff) can remove an attachment.
  if (message.sender_user_id !== ctx.userId && !['staff', 'super_admin'].includes(ctx.role)) {
    throw new ForbiddenError('only the message sender can remove its attachments')
  }
  const ok = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deleteAttachment(c, ctx.appId, ctx.tenantId, attachmentId),
  )
  if (!ok) throw new NotFoundError('attachment')
}
