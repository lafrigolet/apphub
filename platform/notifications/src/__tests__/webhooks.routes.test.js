// webhooks.routes — public Resend + Twilio delivery webhooks. The service layer
// is mocked; we assert routing, secret/signature gating (401), and 200-always.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const wh = vi.hoisted(() => ({
  verifyResendWebhook: vi.fn(), handleResendEvent: vi.fn(),
  verifyTwilioSignature: vi.fn(), handleTwilioStatus: vi.fn(),
}))
vi.mock('../services/webhook.service.js', () => wh)

import { webhooksRoutes } from '../routes/webhooks.routes.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  const zodCompiler = ({ schema }) => (data) => {
    if (schema?.safeParse) {
      const r = schema.safeParse(data)
      return r.success ? { value: r.data } : { error: r.error }
    }
    return { value: data }
  }
  app.setValidatorCompiler(zodCompiler)
  // Twilio posts form-encoded — register a parser so req.body is an object.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const out = {}
    for (const [k, v] of new URLSearchParams(body)) out[k] = v
    done(null, out)
  })
  // Set the error handler BEFORE registering the route plugin so it is
  // inherited by the plugin's encapsulated context; otherwise schema
  // validation failures surface as a raw 400 instead of mapping to 422.
  // Mirrors platform-core boot order (setErrorHandler before modules).
  app.setErrorHandler((err, req, reply) => {
    if (err.name === 'ZodError' || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR' } })
    }
    return reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL' } })
  })
  await app.register(webhooksRoutes, { prefix: '/v1/notifications/webhooks' })
  await app.ready()
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  wh.verifyResendWebhook.mockResolvedValue(true)
  wh.handleResendEvent.mockResolvedValue({ handled: true })
  wh.verifyTwilioSignature.mockResolvedValue(true)
  wh.handleTwilioStatus.mockResolvedValue({ handled: true })
  app = await buildApp()
})
afterEach(async () => { await app.close() })

const J = { 'Content-Type': 'application/json' }

describe('POST /resend', () => {
  it('200 + handled when secret verifies', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/webhooks/resend', headers: J, payload: { type: 'email.bounced', data: { to: ['a@x'] } } })
    expect(res.statusCode).toBe(200)
    expect(res.json().received).toBe(true)
    expect(wh.handleResendEvent).toHaveBeenCalled()
  })
  it('401 when the secret check fails', async () => {
    wh.verifyResendWebhook.mockResolvedValue(false)
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/webhooks/resend', headers: J, payload: { type: 'email.bounced' } })
    expect(res.statusCode).toBe(401)
    expect(wh.handleResendEvent).not.toHaveBeenCalled()
  })
  it('still 200 when processing throws (no provider retry storm)', async () => {
    wh.handleResendEvent.mockRejectedValue(new Error('boom'))
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/webhooks/resend', headers: J, payload: { type: 'email.bounced' } })
    expect(res.statusCode).toBe(200)
  })
  it('422 when body lacks type', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/webhooks/resend', headers: J, payload: { data: {} } })
    expect(res.statusCode).toBe(422)
  })
})

describe('POST /twilio', () => {
  it('200 + handled when signature verifies', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/webhooks/twilio',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      payload: 'MessageSid=SM1&MessageStatus=delivered',
    })
    expect(res.statusCode).toBe(200)
    expect(wh.handleTwilioStatus).toHaveBeenCalledWith(expect.objectContaining({ MessageSid: 'SM1' }))
  })
  it('401 when signature invalid', async () => {
    wh.verifyTwilioSignature.mockResolvedValue(false)
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/webhooks/twilio',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      payload: 'MessageSid=SM1&MessageStatus=delivered',
    })
    expect(res.statusCode).toBe(401)
  })
  it('still 200 when processing throws', async () => {
    wh.handleTwilioStatus.mockRejectedValue(new Error('boom'))
    const res = await app.inject({
      method: 'POST', url: '/v1/notifications/webhooks/twilio',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      payload: 'MessageSid=SM1&MessageStatus=delivered',
    })
    expect(res.statusCode).toBe(200)
  })
})
