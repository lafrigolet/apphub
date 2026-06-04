// send-log.service — sink best-effort hacia platform_notifications.send_log.
// Contrato:
//   - NODE_ENV='test' → no-op (no toca la pool).
//   - resto → repo.insert con la entrada normalizada (template ?? 'raw',
//     recipient ?? 'unknown', error truncado a 2000).
//   - NUNCA propaga: fallo de insert/connect → logger.error y silencio.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test' } }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(client) },
}))

const insert = vi.hoisted(() => vi.fn())
vi.mock('../repositories/send-log.repository.js', () => ({ insert }))

import { logSend } from '../services/send-log.service.js'
import { env } from '../lib/env.js'
import { pool } from '../lib/db.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  env.NODE_ENV = 'production'
  insert.mockResolvedValue({ id: 'sl1' })
})

describe('logSend', () => {
  it('NODE_ENV=test → no-op (no conecta a la pool)', async () => {
    env.NODE_ENV = 'test'
    await logSend({ channel: 'email', template: 'x', recipient: 'a@b', status: 'sent' })
    expect(pool.connect).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('inserta la entrada normalizada y libera el client', async () => {
    await logSend({
      appId: 'aikikan', tenantId: 't1', userId: 'u1',
      channel: 'email', template: 'user.welcome', recipient: 'a@b', status: 'sent',
    })
    expect(insert).toHaveBeenCalledWith(client, expect.objectContaining({
      appId: 'aikikan', tenantId: 't1', userId: 'u1',
      channel: 'email', template: 'user.welcome', recipient: 'a@b',
      status: 'sent', error: null,
    }))
    expect(client.release).toHaveBeenCalled()
  })

  it('defaults: template→raw, recipient→unknown', async () => {
    await logSend({ channel: 'email', status: 'skipped' })
    expect(insert).toHaveBeenCalledWith(client, expect.objectContaining({
      template: 'raw', recipient: 'unknown',
    }))
  })

  it('trunca error a 2000 chars', async () => {
    await logSend({ channel: 'sms', status: 'failed', error: 'x'.repeat(5000) })
    expect(insert.mock.calls[0][1].error).toHaveLength(2000)
  })

  it('insert lanza → no propaga, logger.error + release', async () => {
    insert.mockRejectedValue(new Error('boom'))
    await expect(
      logSend({ channel: 'push', template: 'k', recipient: 'u1', status: 'sent' }),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'push' }), 'failed to write send_log',
    )
    expect(client.release).toHaveBeenCalled()
  })

  it('pool.connect lanza → no propaga', async () => {
    pool.connect.mockRejectedValueOnce(new Error('no db'))
    await expect(
      logSend({ channel: 'email', status: 'sent' }),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})
