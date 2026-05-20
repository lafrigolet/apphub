import { pool, withTenantTransaction } from '../lib/db.js'
import { env } from '../lib/env.js'
import * as repo from '../repositories/resources.repository.js'

const APP_ID = env.EXPECTED_APP_ID

export async function listResources(tenantId, { type, activeOnly = true } = {}) {
  return withTenantTransaction(pool, APP_ID, tenantId, null, (client) =>
    repo.listResources(client, { type, activeOnly }),
  )
}
