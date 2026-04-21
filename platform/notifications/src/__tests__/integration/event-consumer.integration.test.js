/**
 * Integration tests for the notifications event consumer — require a running Redis.
 *
 * Start dependencies:  docker compose up redis -d
 * Run:                 pnpm --filter @apphub/platform-notifications test:integration
 *
 * The email service is spied on but NOT mocked: in test/dev mode (SENDGRID_API_KEY=dev_no_sendgrid)
 * it logs instead of calling SendGrid, so no real emails are sent.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Redis from 'ioredis'

const CHANNEL = 'platform:events'

let publisher     // standalone Redis client used to publish test events

beforeAll(async () => {
  publisher = new Redis(process.env.REDIS_URL)
  await publisher.ping()
})

afterAll(() => publisher.quit())

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Waits for subscription to be ready, publishes an event, then polls until
 * the condition fn returns true or the timeout is reached.
 */
async function publishAndWait(sub, event, condition, timeoutMs = 3000) {
  await sub.ready
  const deadline = Date.now() + timeoutMs
  await publisher.publish(CHANNEL, JSON.stringify(event))
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`Condition not met within ${timeoutMs}ms after publishing ${event.type}`)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('event-consumer with real Redis pub/sub', () => {
  it('processes user.registered event and logs email (dev mode — no SendGrid)', async () => {
    const { logger } = await import('../../lib/logger.js')
    vi.spyOn(logger, 'info')

    const { startEventConsumer } = await import('../../services/event-consumer.js')
    const sub = startEventConsumer()

    try {
      const event = { type: 'user.registered', payload: { email: 'integ@test.com', appId: 'yoga-studio' } }

      await publishAndWait(
        sub,
        event,
        async () => {
          const calls = logger.info.mock.calls
          return calls.some(([meta]) => typeof meta === 'object' && meta?.to === 'integ@test.com')
        },
      )

      const matchingCall = logger.info.mock.calls.find(([meta]) => meta?.to === 'integ@test.com')
      expect(matchingCall).toBeTruthy()
      expect(matchingCall[0].to).toBe('integ@test.com')
    } finally {
      await sub.quit()
      vi.restoreAllMocks()
    }
  })

  it('processes auth.password_reset_requested event and logs reset email', async () => {
    const { logger } = await import('../../lib/logger.js')
    vi.spyOn(logger, 'info')

    const { startEventConsumer } = await import('../../services/event-consumer.js')
    const sub = startEventConsumer()

    try {
      const event = {
        type: 'auth.password_reset_requested',
        payload: { email: 'reset@test.com', token: 'test-reset-uuid-123', userId: 'u1', appId: 'yoga-studio', tenantId: 't1' },
      }

      await publishAndWait(
        sub,
        event,
        async () => {
          return logger.info.mock.calls.some(([meta]) => meta?.to === 'reset@test.com')
        },
      )

      const matchingCall = logger.info.mock.calls.find(([meta]) => meta?.to === 'reset@test.com')
      expect(matchingCall).toBeTruthy()
    } finally {
      await sub.quit()
      vi.restoreAllMocks()
    }
  })

  it('does not crash on malformed JSON', async () => {
    const { logger } = await import('../../lib/logger.js')
    vi.spyOn(logger, 'error')

    const { startEventConsumer } = await import('../../services/event-consumer.js')
    const sub = startEventConsumer()

    try {
      await sub.ready

      // Publish raw malformed payload
      await publisher.publish(CHANNEL, '{bad json:::}')

      // Give the consumer time to receive and (silently) ignore it
      await new Promise(r => setTimeout(r, 300))

      // The consumer swallows parse errors — no error logged, no crash
      const parseErrorCalls = logger.error.mock.calls.filter(([meta]) => meta?.err)
      expect(parseErrorCalls).toHaveLength(0)
    } finally {
      await sub.quit()
      vi.restoreAllMocks()
    }
  })

  it('ignores unknown event types without errors', async () => {
    const { logger } = await import('../../lib/logger.js')
    vi.spyOn(logger, 'error')
    vi.spyOn(logger, 'info')

    const { startEventConsumer } = await import('../../services/event-consumer.js')
    const sub = startEventConsumer()

    try {
      await sub.ready

      const event = { type: 'some.unknown.event', payload: { data: 'irrelevant' } }
      await publisher.publish(CHANNEL, JSON.stringify(event))

      await new Promise(r => setTimeout(r, 300))

      // No email-related log calls, no errors
      const emailCalls = logger.info.mock.calls.filter(([meta]) => meta?.to)
      expect(emailCalls).toHaveLength(0)
      expect(logger.error).not.toHaveBeenCalled()
    } finally {
      await sub.quit()
      vi.restoreAllMocks()
    }
  })
})
