import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/messaging.repository.js'
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
    const message = await repo.insertMessage(c, ctx.appId, ctx.tenantId, threadId, ctx.userId, body, attachments ?? [])
    const recipientUserId = thread.buyer_user_id === ctx.userId ? thread.vendor_user_id : thread.buyer_user_id
    await publish({
      type: 'message.created',
      payload: {
        messageId: message.id, threadId, appId: ctx.appId, tenantId: ctx.tenantId,
        senderUserId: ctx.userId, recipientUserId, orderId: thread.order_id,
      },
    })
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
