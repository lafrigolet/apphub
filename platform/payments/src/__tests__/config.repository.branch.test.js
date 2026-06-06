// Cubre la rama `updatedByUserId ?? null` de upsertValue cuando no se
// pasa userId (p.ej. seed/bootstrap sin actor identificado).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@apphub/platform-sdk/crypto', () => ({
  encryptSecret: vi.fn((s) => Buffer.from(`enc(${s})`)),
  decryptSecret: vi.fn((b) => Buffer.from(b).toString('utf8')),
}))

import * as repo from '../repositories/config.repository.js'

beforeEach(() => vi.clearAllMocks())

describe('upsertValue sin updatedByUserId', () => {
  it('persiste updated_by_user_id = null', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    await repo.upsertValue(client, 'stripe_test_secret_key', 'sk_test_x')
    const [, params] = client.query.mock.calls[0]
    expect(params[2]).toBeNull()
  })
})
