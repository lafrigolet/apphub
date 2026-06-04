import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
    RESEND_API_KEY: undefined,
    EMAIL_FROM_ADDRESS: 'noreply@test.local',
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/email.service.js', () => ({
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}))

// Idempotency + preference gates: claim always succeeds, nothing muted, so
// these tests keep exercising the original dispatch behaviour.
vi.mock('../services/idempotency.service.js', () => ({ claimEvent: vi.fn().mockResolvedValue(true) }))
vi.mock('../services/preferences.service.js', () => ({ isMuted: vi.fn().mockResolvedValue(false) }))

// Capture the Redis message handler so we can call it directly in tests
let capturedMessageHandler
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn((_channel, cb) => cb(null)),
    on: vi.fn((event, handler) => {
      if (event === 'message') capturedMessageHandler = handler
    }),
  })),
}))

import { startEventConsumer } from '../services/event-consumer.js'
import { sendWelcomeEmail, sendPasswordResetEmail } from '../services/email.service.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  capturedMessageHandler = undefined
  startEventConsumer()
})

async function emit(event) {
  await capturedMessageHandler('platform:events', JSON.stringify(event))
}

// ── user.registered ───────────────────────────────────────────────────────────

describe('user.registered event', () => {
  it('calls sendWelcomeEmail with correct args', async () => {
    await emit({ type: 'user.registered', payload: { email: 'a@test.com', appId: 'yoga-studio' } })
    // El sender acepta un 3er arg `locale` (default 'es') desde la migración i18n.
    expect(sendWelcomeEmail).toHaveBeenCalledWith('a@test.com', 'yoga-studio', 'es')
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('skips when email is absent from payload', async () => {
    await emit({ type: 'user.registered', payload: { appId: 'yoga-studio' } })
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it('skips when payload is undefined', async () => {
    await emit({ type: 'user.registered' })
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
  })
})

// ── auth.password_reset_requested ────────────────────────────────────────────

describe('auth.password_reset_requested event', () => {
  it('calls sendPasswordResetEmail with URL containing the token', async () => {
    await emit({ type: 'auth.password_reset_requested', payload: { email: 'a@test.com', token: 'reset-uuid-123' } })
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'a@test.com',
      expect.stringContaining('reset-uuid-123'),
      'es',
    )
  })

  it('skips when email is absent', async () => {
    await emit({ type: 'auth.password_reset_requested', payload: { token: 'reset-uuid-123' } })
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('skips when token is absent', async () => {
    await emit({ type: 'auth.password_reset_requested', payload: { email: 'a@test.com' } })
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })
})

// ── unknown / malformed ───────────────────────────────────────────────────────

describe('unknown or malformed events', () => {
  it('is a no-op for unknown event types', async () => {
    await emit({ type: 'some.other.event', payload: {} })
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('silently ignores malformed JSON', async () => {
    await capturedMessageHandler('platform:events', 'not-valid-json}}}')
    expect(sendWelcomeEmail).not.toHaveBeenCalled()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('logs error and does not crash when email sending throws', async () => {
    sendWelcomeEmail.mockRejectedValue(new Error('Resend down'))
    await emit({ type: 'user.registered', payload: { email: 'a@test.com', appId: 'yoga-studio' } })
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), event: expect.any(Object) }),
      expect.any(String),
    )
  })
})
