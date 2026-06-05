import { NotFoundError, ConflictError } from '@apphub/platform-sdk/errors'
import { withTenantTransaction } from '../lib/db.js'
import * as factsRepo from '../repositories/billing-facts.repository.js'
import * as sessionsRepo from '../repositories/cash-sessions.repository.js'
import * as movementsRepo from '../repositories/cash-movements.repository.js'

export async function listFacts(identity, filters) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    factsRepo.list(c, filters))
}

// Re-imputación manual de un fact huérfano (pago sin deviceId o sin sesión
// abierta en su momento) a una sesión. Repite la imputación de efectivo que
// el handler no pudo hacer.
export async function attributeFact(identity, factId, { sessionId }) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const session = await sessionsRepo.findById(c, sessionId)
    if (!session) throw new NotFoundError('Session not found')
    if (session.status !== 'open') throw new ConflictError(`Session is ${session.status}`)

    const fact = await factsRepo.attribute(c, factId, sessionId)
    if (!fact) throw new ConflictError('Billing fact not found or already attributed')

    const cashCents = (fact.payments ?? [])
      .filter((x) => x.method === 'cash')
      .reduce((s, x) => s + Number(x.amountCents ?? 0) + Number(x.tipCents ?? 0), 0)

    if (cashCents > 0) {
      await movementsRepo.insert(c, {
        appId: identity.appId,
        tenantId: identity.tenantId,
        subTenantId: identity.subTenantId ?? null,
        sessionId,
        kind: 'sale_cash',
        amountCents: cashCents,
        reason: `Re-imputación venta bill ${fact.bill_id}`,
        actorId: identity.userId,
        source: 'manual',
        billingFactId: fact.id,
      })
    }
    return fact
  })
}
