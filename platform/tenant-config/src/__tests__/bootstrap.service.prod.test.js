// bootstrap.service — variante con PLATFORM_CORE_URL de producción para
// cubrir la rama https:// de magicLinkUrl.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_CORE_URL: 'http://platform-core:3000', // prod-like (no hulkstein.local/localhost)
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: {} }))
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/nginx-config.service.js', () => ({
  writeAppNginxConfig: vi.fn(), writeTenantNginxConfig: vi.fn(),
  deleteTenantNginxConfig: vi.fn(), deleteAppNginxConfig: vi.fn(),
}))
vi.mock('../repositories/apps.repository.js')
vi.mock('../repositories/tenants.repository.js')
vi.mock('../repositories/audit.repository.js')

import { bootstrapTenant } from '../services/bootstrap.service.js'
import { withTransaction } from '../lib/db.js'
import * as appsRepo from '../repositories/apps.repository.js'

beforeEach(() => { vi.clearAllMocks(); global.fetch = vi.fn() })

it('magicLinkUrl usa https://<subdomain>.hulkstein.com en prod', async () => {
  appsRepo.findByAppId.mockResolvedValue({ app_id: 'aikikan', display_name: 'A', subdomain: 'aikikan' })
  const tenantRow = { id: 't1', display_name: 'Dojo', subdomain: 'dojo', app_id: 'aikikan' }
  withTransaction.mockImplementation(async (_p, fn) => fn({
    query: vi.fn().mockImplementation(async (sql) =>
      /INSERT INTO platform_tenants\.tenants/.test(sql) ? { rows: [tenantRow] } : { rows: [] }),
  }))
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { userId: 'o1', plainToken: 'tok', expiresAt: 's' } }) })

  const r = await bootstrapTenant({
    app: { appId: 'aikikan', displayName: 'A', subdomain: 'aikikan' },
    tenant: { displayName: 'Dojo', subdomain: 'dojo' },
    owner: { email: 'o@x.com', displayName: 'O' },
  }, { userId: 'u1', role: 'staff' })

  expect(r.owner.magicLinkUrl).toBe('https://dojo.hulkstein.com/activate?token=tok')
})
