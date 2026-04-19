import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    YOGA_SENDGRID_API_KEY: 'SG.test_key',
    YOGA_SENDGRID_FROM_EMAIL: 'noreply@yoga.com',
    LOG_LEVEL: 'silent',
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn(),
  },
}))

import sgMail from '@sendgrid/mail'
import { sendEmail } from '../services/mailer.js'

beforeEach(() => vi.clearAllMocks())

describe('mailer.sendEmail', () => {
  it('sends email via SendGrid with correct params', async () => {
    sgMail.send.mockResolvedValue([{ statusCode: 202 }])

    await sendEmail({ to: 'user@yoga.com', subject: 'Test', text: 'Hello!' })

    expect(sgMail.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@yoga.com',
      from: 'noreply@yoga.com',
      subject: 'Test',
      text: 'Hello!',
    }))
  })

  it('uses text as html fallback when html not provided', async () => {
    sgMail.send.mockResolvedValue([{ statusCode: 202 }])
    await sendEmail({ to: 'u@y.com', subject: 'S', text: 'plain text' })
    const [arg] = sgMail.send.mock.calls[0]
    expect(arg.html).toBe('plain text')
  })

  it('uses provided html when given', async () => {
    sgMail.send.mockResolvedValue([{ statusCode: 202 }])
    await sendEmail({ to: 'u@y.com', subject: 'S', text: 'plain', html: '<b>bold</b>' })
    const [arg] = sgMail.send.mock.calls[0]
    expect(arg.html).toBe('<b>bold</b>')
  })

  it('throws and logs when SendGrid fails', async () => {
    sgMail.send.mockRejectedValue(new Error('SendGrid API error'))
    const { logger } = await import('../lib/logger.js')

    await expect(sendEmail({ to: 'u@y.com', subject: 'S', text: 'T' })).rejects.toThrow('SendGrid API error')
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('mailer.sendEmail (dev mode — no API key)', () => {
  it('logs instead of sending when API key not configured', async () => {
    const { env } = await import('../lib/env.js')
    const originalKey = env.YOGA_SENDGRID_API_KEY

    // Simulate dev mode by temporarily removing the key reference
    // (The module checks env at call time, but since we mocked env,
    //  we test the branch by having the mock return undefined)
    vi.mocked(env).YOGA_SENDGRID_API_KEY = undefined
    const { logger } = await import('../lib/logger.js')

    await sendEmail({ to: 'u@y.com', subject: 'S', text: 'T' })

    expect(sgMail.send).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalled()

    vi.mocked(env).YOGA_SENDGRID_API_KEY = originalKey
  })
})
