import { withTenantTransaction } from '../lib/db.js'
import * as convRepo from '../repositories/conversations.repository.js'
import { requireStaff, ensureFound } from './guards.js'

// Tenant-wide chat metrics for the staff dashboard.
export async function metrics(ctx, sinceDays = 7) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    convRepo.metrics(c, sinceDays),
  )
}

// Export the live messages of a single conversation (audit / GDPR export).
export async function exportConversation(ctx, conversationId) {
  requireStaff(ctx)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const conv = ensureFound(await convRepo.findById(c, conversationId), 'Conversation')
    const messages = await convRepo.exportMessages(c, conversationId)
    return { conversation: conv, messages }
  })
}
