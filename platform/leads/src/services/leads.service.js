import { pool } from '../lib/db.js'
import { getRedis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/leads.repository.js'

// Publica DESPUÉS de soltar el client (la fila ya está persistida). Un fallo
// al publicar NO propaga: mejor un lead sin notificación que perder el lead.
async function publish(type, payload) {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.publish('platform.events', JSON.stringify({ type, payload }))
  } catch (err) {
    logger.error({ err, type }, `failed to publish ${type}`)
  }
}

export async function create(lead) {
  const client = await pool.connect()
  let created
  let deduped = false
  try {
    // Dedup (§4): si ya existe un lead ABIERTO con este email (mismo app_id),
    // no duplicamos: adjuntamos el mensaje como actividad y refrescamos el lead.
    // Vale tanto para el formulario público como para el email entrante.
    const existing = lead.email ? await repo.findOpenByEmail(client, lead.email, lead.appId ?? null) : null
    if (existing) {
      await client.query('BEGIN')
      try {
        await repo.insertActivity(client, existing.id, {
          type:     'note',
          body:     lead.message ?? null,
          metadata: { resubmission: true, source: lead.source ?? null },
        })
        await repo.touch(client, existing.id)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      }
      created = existing
      deduped = true
      logger.info({ leadId: existing.id, source: lead.source }, 'Lead resubmission deduped')
    } else {
      created = await repo.insert(client, {
        ...lead,
        // Consentimiento LOPDGDD: si el form mandó texto/versión, sellamos el
        // momento de la aceptación.
        consentAt: (lead.consentText || lead.consentVersion) ? new Date() : null,
      })
      logger.info({ leadId: created.id, industry: lead.industry }, 'Lead created')
    }
  } finally {
    client.release()
  }

  // Una resubmisión no es un alta nueva: no dispara lead.created (ni su
  // auto-respuesta). Emitimos lead.resubmitted para que staff pueda enterarse.
  if (deduped) {
    await publish('lead.resubmitted', {
      leadId: created.id,
      email:  lead.email,
      source: lead.source ?? null,
      appId:  lead.appId ?? null,
    })
  } else {
    await publish('lead.created', {
      leadId:       created.id,
      email:        lead.email,
      contactName:  lead.contactName,
      businessName: lead.businessName ?? null,
      industry:     lead.industry ?? null,
      source:       lead.source ?? null,
      appId:        lead.appId ?? null,
    })
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

// Update parcial con timeline + eventos. `actor` = req.identity del staff
// ({ userId, email }) para que las entradas de actividad lleven autor.
export async function update(id, patch, actor = {}) {
  const client = await pool.connect()
  let before, updated
  try {
    await client.query('BEGIN')
    before = await repo.findById(client, id)
    if (!before) { await client.query('ROLLBACK'); return null }

    updated = await repo.update(client, id, patch)

    const author = { authorUserId: actor.userId ?? null, authorEmail: actor.email ?? null }
    if (patch.status !== undefined && patch.status !== before.status) {
      await repo.insertActivity(client, id, {
        ...author,
        type:     'status_change',
        body:     patch.lostReason ?? null,
        metadata: { from: before.status, to: patch.status },
      })
    }
    if (patch.assignedTo !== undefined && patch.assignedTo !== before.assigned_to) {
      await repo.insertActivity(client, id, {
        ...author,
        type:     'assignment',
        metadata: { from: before.assigned_to, to: patch.assignedTo },
      })
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  if (patch.status !== undefined && patch.status !== before.status) {
    await publish('lead.status_changed', {
      leadId: id, from: before.status, to: patch.status,
      lostReason: patch.lostReason ?? null, byUserId: actor.userId ?? null,
    })
  }
  if (patch.assignedTo !== undefined && patch.assignedTo !== before.assigned_to) {
    await publish('lead.assigned', {
      leadId: id, assignedTo: patch.assignedTo, byUserId: actor.userId ?? null,
    })
  }
  return updated
}

// Conversión lead → tenant provisionado (trazabilidad lead_id → tenant_id).
// Devuelve { lead } | { conflict: true } | null (no existe).
export async function convert(id, tenantId, actor = {}) {
  const client = await pool.connect()
  let converted
  try {
    await client.query('BEGIN')
    converted = await repo.convert(client, id, tenantId)
    if (!converted) {
      await client.query('ROLLBACK')
      const existing = await repo.findById(client, id)
      return existing ? { conflict: true } : null
    }
    await repo.insertActivity(client, id, {
      authorUserId: actor.userId ?? null,
      authorEmail:  actor.email ?? null,
      type:         'system',
      body:         `converted to tenant ${tenantId}`,
      metadata:     { tenantId },
    })
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  await publish('lead.converted', { leadId: id, tenantId, byUserId: actor.userId ?? null })
  return { lead: converted }
}

// GDPR — borrado físico (right to be forgotten). Las activities caen en
// cascada. El evento NO lleva el email (es justo lo que estamos borrando).
export async function removeLead(id, actor = {}) {
  const client = await pool.connect()
  let removed
  try { removed = await repo.remove(client, id) } finally { client.release() }
  if (!removed) return null
  logger.info({ leadId: id, byUserId: actor.userId }, 'Lead deleted (GDPR)')
  await publish('lead.deleted', { leadId: id, byUserId: actor.userId ?? null })
  return removed
}

// ── Timeline ────────────────────────────────────────────────────────────

export async function addActivity(id, entry, actor = {}) {
  const client = await pool.connect()
  try {
    const lead = await repo.findById(client, id)
    if (!lead) return null
    return await repo.insertActivity(client, id, {
      ...entry,
      authorUserId: actor.userId ?? null,
      authorEmail:  actor.email ?? null,
    })
  } finally {
    client.release()
  }
}

export async function listActivities(id, opts) {
  const client = await pool.connect()
  try {
    const lead = await repo.findById(client, id)
    if (!lead) return null
    return await repo.listActivities(client, id, opts)
  } finally {
    client.release()
  }
}

// Legacy — conservado para compatibilidad con callers antiguos.
export async function setStatus(id, status, staffNotes) {
  return update(id, { status, ...(staffNotes != null ? { staffNotes } : {}) })
}
