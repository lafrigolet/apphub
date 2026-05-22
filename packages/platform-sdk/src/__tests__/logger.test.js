// platform-sdk/logger — wrapper de pino con configuración por entorno.
// Contrato:
//   - createLogger(serviceName): pino con base.service = serviceName.
//   - level: opts.level ?? process.env.LOG_LEVEL ?? 'info'.
//   - transport pino-pretty SOLO cuando nodeEnv === 'development'; en
//     test/prod usa JSON estándar.
//   - opts.nodeEnv prevalece sobre process.env.NODE_ENV.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pino para inspeccionar los args con los que se construye.
const pinoCtorMock = vi.hoisted(() => vi.fn().mockImplementation((opts) => ({
  _opts: opts,
  info:  vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockImplementation(function () { return this }),
})))

vi.mock('pino', () => ({ default: pinoCtorMock }))

import { createLogger } from '../logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.LOG_LEVEL
  delete process.env.NODE_ENV
})

// ── base.service ────────────────────────────────────────────────────

describe('base service tag', () => {
  it('siempre incluye base.service = serviceName (sin esto, los logs no se pueden filtrar)', () => {
    createLogger('platform-auth')
    expect(pinoCtorMock).toHaveBeenCalledWith(expect.objectContaining({
      base: { service: 'platform-auth' },
    }))
  })

  it('serviceName custom propaga (regression — no hardcoding)', () => {
    createLogger('aulavera-server')
    expect(pinoCtorMock.mock.calls[0][0].base.service).toBe('aulavera-server')
  })
})

// ── level resolution ────────────────────────────────────────────────

describe('log level', () => {
  it('opts.level explicit → wins (prioritario sobre env)', () => {
    process.env.LOG_LEVEL = 'warn'
    createLogger('x', { level: 'debug' })
    expect(pinoCtorMock.mock.calls[0][0].level).toBe('debug')
  })

  it('opts.level ausente + LOG_LEVEL env → usa env', () => {
    process.env.LOG_LEVEL = 'trace'
    createLogger('x')
    expect(pinoCtorMock.mock.calls[0][0].level).toBe('trace')
  })

  it('sin opts.level ni LOG_LEVEL → default "info"', () => {
    createLogger('x')
    expect(pinoCtorMock.mock.calls[0][0].level).toBe('info')
  })
})

// ── transport pino-pretty (solo development) ────────────────────────

describe('pino-pretty transport', () => {
  it('opts.nodeEnv="development" → activa pino-pretty con colorize', () => {
    createLogger('x', { nodeEnv: 'development' })
    expect(pinoCtorMock.mock.calls[0][0].transport).toEqual({
      target: 'pino-pretty',
      options: { colorize: true },
    })
  })

  it('opts.nodeEnv="production" → SIN transport (JSON estructurado para logs centralizados)', () => {
    createLogger('x', { nodeEnv: 'production' })
    expect(pinoCtorMock.mock.calls[0][0].transport).toBeUndefined()
  })

  it('opts.nodeEnv="test" → SIN transport (silencioso JSON)', () => {
    createLogger('x', { nodeEnv: 'test' })
    expect(pinoCtorMock.mock.calls[0][0].transport).toBeUndefined()
  })

  it('opts.nodeEnv ausente + NODE_ENV=development → pino-pretty', () => {
    process.env.NODE_ENV = 'development'
    createLogger('x')
    expect(pinoCtorMock.mock.calls[0][0].transport).toBeDefined()
  })

  it('opts.nodeEnv ausente + NODE_ENV=production → SIN transport', () => {
    process.env.NODE_ENV = 'production'
    createLogger('x')
    expect(pinoCtorMock.mock.calls[0][0].transport).toBeUndefined()
  })

  it('opts.nodeEnv prevalece sobre process.env.NODE_ENV', () => {
    process.env.NODE_ENV = 'development'
    createLogger('x', { nodeEnv: 'production' })
    expect(pinoCtorMock.mock.calls[0][0].transport).toBeUndefined()
  })
})

// ── Instance ────────────────────────────────────────────────────────

describe('logger instance shape', () => {
  it('retorna el logger devuelto por pino()', () => {
    const log = createLogger('x')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.child).toBe('function')
  })
})
