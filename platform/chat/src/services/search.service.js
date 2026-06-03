import { withTenantTransaction } from '../lib/db.js'
import { ValidationError } from '@apphub/platform-sdk/errors'
import * as msgRepo from '../repositories/messages.repository.js'

// Full-text search across the caller's conversations. Uses the body_tsv GIN
// index (simple config, language-agnostic). RLS keeps results within the
// caller's tenant; the JOIN on participants keeps them within conversations
// the caller actually belongs to.
export async function search(ctx, q, filters = {}) {
  if (!q || !q.trim()) throw new ValidationError('search query is required')
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, (c) =>
    msgRepo.search(c, ctx.userId, q.trim(), filters),
  )
}
