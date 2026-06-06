import { pool, withTenantTransaction } from '../lib/db.js'
import { env } from '../lib/env.js'
import * as repo from '../repositories/events.repository.js'

const APP_ID = 'aulavera' // literal: en apps-servers el env es compartido (ADR 018)

export async function listEvents(tenantId, { kind, status }) {
  return withTenantTransaction(pool, APP_ID, tenantId, null, (client) =>
    repo.listEvents(client, { kind, status }),
  )
}

export async function getEvent(tenantId, id) {
  return withTenantTransaction(pool, APP_ID, tenantId, null, (client) =>
    repo.findEventById(client, id),
  )
}
