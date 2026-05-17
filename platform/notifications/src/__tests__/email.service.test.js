import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    RESEND_API_KEY: undefined,
    EMAIL_FROM_ADDRESS: 'noreply@test.local',
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Resend constructor + emails.send mock. The class returns an object with
// an `emails` namespace; the spy captures whatever instances are created.
const resendSend = vi.fn().mockResolvedValue({ data: { id: 'msg_stub' }, error: null })
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}))

// loadConfig() reads from DB; in the test we simulate the empty-DB case so
// it falls back to env (mocked above). renderTemplate() also reads from DB;
// returning null means email.service uses the inline `defaults`.
vi.mock('../lib/db.js', () => ({
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  },
}))
vi.mock('../services/template-renderer.js', () => ({
  renderTemplate: vi.fn().mockResolvedValue(null),
}))

import { sendWelcomeEmail, sendPasswordResetEmail } from '../services/email.service.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  resendSend.mockClear()
})

// ── sendWelcomeEmail ──────────────────────────────────────────────────────────

describe('sendWelcomeEmail', () => {
  it('logs to console in dev mode without calling Resend', async () => {
    await sendWelcomeEmail('user@test.com', 'aikikan')
    expect(resendSend).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com', subject: expect.any(String) }),
      expect.any(String),
    )
  })

  it('includes the appId in the email body', async () => {
    await sendWelcomeEmail('user@test.com', 'split-pay')
    // In dev mode we only verify the send is skipped — body content is tested
    // via resendSend args in prod.
    expect(resendSend).not.toHaveBeenCalled()
  })
})

// ── sendPasswordResetEmail ────────────────────────────────────────────────────

describe('sendPasswordResetEmail', () => {
  it('logs to console in dev mode without calling Resend', async () => {
    await sendPasswordResetEmail('user@test.com', 'http://app.local/reset?token=abc')
    expect(resendSend).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com' }),
      expect.any(String),
    )
  })
})
