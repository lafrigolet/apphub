import { pool } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/leads.repository.js'

export async function create(lead) {
  const client = await pool.connect()
  try {
    const created = await repo.insert(client, lead)
    logger.info({ leadId: created.id, industry: lead.industry }, 'Lead created')
    return created
  } finally {
    client.release()
  }
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
