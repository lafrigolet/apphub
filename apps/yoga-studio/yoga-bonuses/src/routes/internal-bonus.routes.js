import { pool, setTenantContext, withTenantTransaction } from '../lib/db.js'
import * as bonusRepo from '../repositories/bonus.repository.js'
import { ValidationError } from '../utils/errors.js'

export async function internalBonusRoutes(fastify) {
  fastify.get('/:userId/check', { config: { public: true } }, async (req, reply) => {
    const tenantId = req.headers['x-tenant-id']
    const subTenantId = req.headers['x-sub-tenant-id'] ?? null
    if (!tenantId) return reply.status(400).send({ error: { code: 'MISSING_TENANT', message: 'Missing X-Tenant-ID header' } })

    const client = await pool.connect()
    try {
      await setTenantContext(client, tenantId, subTenantId)
      const bonuses = await bonusRepo.getActiveBonuses(client, req.params.userId, tenantId)
      const hasCredits = bonuses.some((b) =>
        b.bonus_type === 'monthly_unlimited' || b.sessions_used < b.sessions_total,
      )
      return reply.send({ data: { hasCredits, bonuses } })
    } finally {
      client.release()
    }
  })

  fastify.post('/:userId/deduct', { config: { public: true } }, async (req, reply) => {
    const tenantId = req.headers['x-tenant-id']
    const subTenantId = req.headers['x-sub-tenant-id'] ?? null
    if (!tenantId) return reply.status(400).send({ error: { code: 'MISSING_TENANT', message: 'Missing X-Tenant-ID header' } })

    const bonus = await withTenantTransaction(tenantId, subTenantId, async (client) => {
      return bonusRepo.checkAndDeductCredit(client, req.params.userId, tenantId)
    })
    if (!bonus) return reply.status(422).send({ error: { code: 'NO_CREDITS', message: 'No credits available' } })
    return reply.send({ data: { success: true, bonusId: bonus.id } })
  })
}
