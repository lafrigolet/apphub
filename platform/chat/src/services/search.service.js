import { withTenantTransaction } from '../lib/db.js'
import { ValidationError } from '@apphub/platform-sdk/errors'
import * as msgRepo from '../repositories/messages.repository.js'
import { resolve as resolveSettings, SEARCH_LANGUAGES } from './settings.service.js'

// Full-text search across the caller's conversations. The text-search config is
// per-tenant (settings.search_language, default 'simple'): 'simple' uses the
// body_tsv GIN index; a language config ('spanish'/'english') enables stemming
// and stop-words. RLS keeps results within the caller's tenant; the JOIN on
// participants keeps them within conversations the caller actually belongs to.
export async function search(ctx, q, filters = {}) {
  if (!q || !q.trim()) throw new ValidationError('search query is required')
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId ?? null, async (c) => {
    const settings = await resolveSettings(c, ctx.appId, ctx.tenantId)
    const lang = SEARCH_LANGUAGES.includes(settings.search_language) ? settings.search_language : 'simple'
    return msgRepo.search(c, ctx.userId, q.trim(), { ...filters, language: lang })
  })
}
