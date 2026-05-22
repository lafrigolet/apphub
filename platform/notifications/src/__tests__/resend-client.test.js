// Tests del cliente Resend a nivel send() — el module `email.service.js`
// llama UNA vez a Resend y registra el error si falla. NO hace retry hoy.
// Este fichero documenta ese contrato actual y marca como `.todo` el
// comportamiento deseado (retry con backoff, supresión de destinatarios
// que bounce, etc.) para que cuando se implemente, el test sea el guard.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'production',       // forzamos el path "send real" (no el skip de tests)
    RESEND_API_KEY: 'resend_test_key',
    EMAIL_FROM_ADDRESS: 'noreply@test.local',
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// loadConfig() lee de DB; con un cliente que devuelve filas vacías, cae
// al fallback de env (que mockeamos arriba).
vi.mock('../lib/db.js', () => ({
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  },
}))

vi.mock('../services/template-renderer.js', () => ({
  renderTemplate: vi.fn().mockResolvedValue(null),     // usa defaults inline
}))

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }))
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}))

import { sendWelcomeEmail, sendRaw } from '../services/email.service.js'
import { logger } from '../lib/logger.js'

beforeEach(() => { vi.clearAllMocks() })

// ── Contrato actual: single-shot, log on error ──────────────────────────

describe('Resend client — comportamiento actual (sin retry)', () => {
  it('llama a Resend.emails.send EXACTAMENTE una vez en happy path', async () => {
    resendSend.mockResolvedValueOnce({ data: { id: 'msg_1' }, error: null })
    await sendWelcomeEmail('user@x.org', 'aikikan')
    expect(resendSend).toHaveBeenCalledTimes(1)
  })

  it('cuando Resend devuelve { error }, registra y NO reintenta', async () => {
    resendSend.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error', message: 'Invalid `to` field' },
    })
    await sendWelcomeEmail('bad@x', 'aikikan')

    expect(resendSend).toHaveBeenCalledTimes(1)              // NO retry
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ name: 'validation_error' }) }),
      'Failed to send email',
    )
  })

  it('cuando Resend throws (network / 5xx), atrapa el error y NO reintenta', async () => {
    resendSend.mockRejectedValueOnce(new Error('ECONNRESET'))
    await sendWelcomeEmail('user@x', 'aikikan')

    expect(resendSend).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to send email',
    )
  })

  it('NO propaga el error — el caller (event-consumer) sigue procesando otros eventos', async () => {
    resendSend.mockRejectedValueOnce(new Error('500 Server Error'))
    await expect(sendWelcomeEmail('user@x', 'aikikan')).resolves.toBeUndefined()
  })
})

describe('Resend client — payload', () => {
  it('pasa `from`, `to`, `subject`, `text`, `html` al SDK', async () => {
    resendSend.mockResolvedValueOnce({ data: { id: 'm' }, error: null })
    await sendRaw({
      to:      'user@x',
      subject: 'Test subject',
      text:    'Plain text body',
      html:    '<p>HTML body</p>',
    })
    expect(resendSend).toHaveBeenCalledWith(expect.objectContaining({
      to:      'user@x',
      subject: 'Test subject',
      text:    'Plain text body',
      html:    '<p>HTML body</p>',
      from:    expect.any(String),
    }))
  })
})

// ── Contrato deseado (cuando se implemente retry/backoff) ────────────────
//
// Cuando alguien añada retry con backoff exponencial + supresión de
// destinatarios bounced, mover estos `it.todo` a `it()` reales.

describe.todo('Resend client — retry con backoff (NO implementado)', () => {
  it.todo('reintenta hasta 3 veces si Resend devuelve 5xx (backoff 100ms/300ms/900ms)')
  it.todo('NO reintenta en 4xx (validation_error, missing_field) — fail fast')
  it.todo('jitter ±25% en los delays para no thundering-herd en bounce massive')
  it.todo('tras N reintentos fallidos, persistir el mensaje en una cola dead-letter para reintento manual')
})

describe.todo('Bounce/complaint handling vía webhooks Resend (NO implementado)', () => {
  it.todo('un POST a /v1/notifications/webhooks/resend con email.bounced suprime el destinatario en una tabla suppression_list')
  it.todo('subsequent sends a un destinatario suprimido devuelven sin llamar a Resend (ahorro $)')
  it.todo('verifica la firma Svix del webhook Resend antes de procesar')
})
