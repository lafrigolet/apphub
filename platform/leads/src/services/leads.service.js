import { pool } from '../lib/db.js'
import { getRedis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/leads.repository.js'

export async function create(lead) {
  const client = await pool.connect()
  let created
  try {
    created = await repo.insert(client, lead)
    logger.info({ leadId: created.id, industry: lead.industry }, 'Lead created')
  } finally {
    client.release()
  }

  // Publica DESPUÉS de soltar el client (la fila ya está persistida). Un fallo
  // al publicar NO propaga: mejor un lead sin notificación que perder el lead.
  const redis = getRedis()
  if (redis) {
    try {
      await redis.publish('platform.events', JSON.stringify({
        type: 'lead.created',
        payload: {
          leadId:       created.id,
          email:        lead.email,
          contactName:  lead.contactName,
          businessName: lead.businessName ?? null,
          industry:     lead.industry ?? null,
          source:       lead.source ?? null,
        },
      }))
    } catch (err) {
      logger.error({ err, leadId: created.id }, 'failed to publish lead.created')
    }
  }
  return created
}

export async function listLeads(filters) {
  const client = await pool.connect()
  try { return await repo.list(client, filters) } finally { client.release() }
}

export async function getById(id) {
  const client = await pool.connect()
  try { return await repo.findById(client, id) } finally { client.release() }
}

export async function setStatus(id, status, staffNotes) {
  const client = await pool.connect()
  try { return await repo.updateStatus(client, id, status, staffNotes) } finally { client.release() }
}
