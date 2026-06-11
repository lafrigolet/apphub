import { pool, withTenantTransaction } from '../lib/db.js'
import { env } from '../lib/env.js'
import * as repo from '../repositories/disciplines.repository.js'

const APP_ID = 'aulavera' // literal: en apps-servers el env es compartido (ADR 018)

export async function listDisciplines(tenantId, { activeOnly = true } = {}) {
  return withTenantTransaction(pool, APP_ID, tenantId, null, (client) =>
    repo.listDisciplines(client, { activeOnly }),
  )
}
