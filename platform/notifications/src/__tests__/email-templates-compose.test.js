// email.service.compose — fallback per-field cuando la plantilla DB tiene
// algún campo NULL. Foco en lo que NO cubre email.service.test.js
// (que solo prueba sendWelcomeEmail dev-mode no-send).
//
// Contrato compose:
//   - renderTemplate returns null → usa defaults completos.
//   - renderTemplate returns object con subject/text/html del DB → usa esos.
//   - renderTemplate returns object con subject=NULL → fallback a defaults.subject
//     (NO null literal a Resend: la API tira "string expected for subject").
//   - locale forward a renderTemplate.
//
// Probamos vía sendWelcomeEmail (el caso más simple que invoca compose).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'production',   // forzamos send (no skip)
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const resendEmailsSendMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: 'em-1' } }))
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: resendEmailsSendMock },
  })),
}))
const renderTemplateMock = vi.hoisted(() => vi.fn())
vi.mock('../services/template-renderer.js', () => ({
  renderTemplate: renderTemplateMock,
}))
const fakeClient = vi.hoisted(() => ({ release: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(fakeClient) },
}))
const configMock = vi.hoisted(() => ({ getValue: vi.fn() }))
vi.mock('../repositories/config.repository.js', () => configMock)

import { sendWelcomeEmail, invalidateConfigCache } from '../services/email.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  invalidateConfigCache()
  // Config con API key → no skip (test send path)
  configMock.getValue.mockImplementation(async (_c, key) => {
    if (key === 'resend_api_key')  return 'rsd_test_key'
    if (key === 'sender_email')    return 'no-reply@test.com'
    if (key === 'sender_name')     return 'AppHub'
    return null
  })
})

// ── DB template ausente → defaults completos ──────────────────────

describe('compose — DB miss', () => {
  it('renderTemplate=null → fallback completo a defaults', async () => {
    renderTemplateMock.mockResolvedValue(null)
    await sendWelcomeEmail('user@x.com', 'aikikan')
    expect(resendEmailsSendMock).toHaveBeenCalledWith(expect.objectContaining({
      to:      'user@x.com',
      subject: 'Bienvenido a aikikan',
      text:    expect.stringContaining('Tu cuenta en aikikan'),
      html:    expect.stringContaining('<strong>aikikan</strong>'),
    }))
  })

  it('locale forward al renderTemplate', async () => {
    renderTemplateMock.mockResolvedValue(null)
    await sendWelcomeEmail('user@x.com', 'aikikan', 'en')
    expect(renderTemplateMock).toHaveBeenCalledWith(
      'user.welcome', { appId: 'aikikan' }, 'email', 'en',
    )
  })
})

// ── DB template completa → usa los 3 fields ────────────────────────

describe('compose — DB hit completo', () => {
  it('DB tiene subject + text + html → usa los del DB (no defaults)', async () => {
    renderTemplateMock.mockResolvedValue({
      subject: 'Custom subject',
      text:    'Custom text',
      html:    '<p>Custom html</p>',
      locale:  'es',
    })
    await sendWelcomeEmail('user@x.com', 'aikikan')
    expect(resendEmailsSendMock).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Custom subject',
      text:    'Custom text',
      html:    '<p>Custom html</p>',
    }))
  })
})

// ── DB template con NULLs → fallback per-field ────────────────────

describe('compose — DB hit con NULLs (fallback per-field)', () => {
  it('subject NULL en DB → usa defaults.subject (anti "string expected" Resend)', async () => {
    renderTemplateMock.mockResolvedValue({
      subject: null,
      text:    'Custom text',
      html:    '<p>Custom html</p>',
      locale:  'es',
    })
    await sendWelcomeEmail('user@x.com', 'aikikan')
    expect(resendEmailsSendMock).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Bienvenido a aikikan',                   // fallback
      text:    'Custom text',
      html:    '<p>Custom html</p>',
    }))
  })

  it('text NULL en DB → usa defaults.text', async () => {
    renderTemplateMock.mockResolvedValue({
      subject: 'Custom subject', text: null,
      html:    '<p>Custom html</p>', locale: 'es',
    })
    await sendWelcomeEmail('user@x.com', 'aikikan')
    const callArgs = resendEmailsSendMock.mock.calls[0][0]
    expect(callArgs.subject).toBe('Custom subject')
    expect(callArgs.text).toContain('Tu cuenta en aikikan')
    expect(callArgs.html).toBe('<p>Custom html</p>')
  })

  it('html NULL en DB → usa defaults.html (CRITICAL — Resend tira string-expected)', async () => {
    renderTemplateMock.mockResolvedValue({
      subject: 'Custom subject', text: 'Custom text',
      html:    null, locale: 'es',
    })
    await sendWelcomeEmail('user@x.com', 'aikikan')
    const callArgs = resendEmailsSendMock.mock.calls[0][0]
    expect(callArgs.html).toContain('<strong>aikikan</strong>')   // default
    expect(callArgs.html).not.toBeNull()                          // never null!
  })

  it('TODOS los fields NULL → todos los defaults (degradación graceful)', async () => {
    renderTemplateMock.mockResolvedValue({
      subject: null, text: null, html: null, locale: 'es',
    })
    await sendWelcomeEmail('user@x.com', 'aikikan')
    const callArgs = resendEmailsSendMock.mock.calls[0][0]
    expect(callArgs.subject).toBe('Bienvenido a aikikan')
    expect(callArgs.text).toContain('Tu cuenta')
    expect(callArgs.html).toContain('<strong>')
  })
})

// ── Resend integration ─────────────────────────────────────────────

describe('Resend integration', () => {
  it('from = "senderName <senderEmail>" cuando senderName presente', async () => {
    renderTemplateMock.mockResolvedValue(null)
    await sendWelcomeEmail('user@x.com', 'aikikan')
    expect(resendEmailsSendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'AppHub <no-reply@test.com>',
    }))
  })

  it('from = senderEmail solo cuando senderName ausente', async () => {
    configMock.getValue.mockImplementation(async (_c, key) => {
      if (key === 'resend_api_key') return 'rsd_test'
      if (key === 'sender_email')   return 'no-reply@x.com'
      if (key === 'sender_name')    return null
      return null
    })
    renderTemplateMock.mockResolvedValue(null)
    await sendWelcomeEmail('user@x.com', 'aikikan')
    expect(resendEmailsSendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: 'no-reply@x.com',
    }))
  })

  it('Resend devuelve error → log.error, NO crashea (best-effort)', async () => {
    renderTemplateMock.mockResolvedValue(null)
    resendEmailsSendMock.mockResolvedValueOnce({ data: null, error: { message: 'Quota exceeded' } })
    await expect(sendWelcomeEmail('user@x.com', 'aikikan')).resolves.toBeUndefined()
  })

  it('Resend throw (red) → log.error pero retorna (no propaga)', async () => {
    renderTemplateMock.mockResolvedValue(null)
    resendEmailsSendMock.mockRejectedValueOnce(new Error('ETIMEDOUT'))
    await expect(sendWelcomeEmail('user@x.com', 'aikikan')).resolves.toBeUndefined()
  })
})
