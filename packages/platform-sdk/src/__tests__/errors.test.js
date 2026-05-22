// platform-sdk/errors — contrato de error classes consumido por todo el monorepo.
// Cambios aquí son BREAKING (rompen guards/handlers en cada módulo).
// Contrato:
//   - AppError: code, message, statusCode, details, name='AppError', extiende Error.
//   - ValidationError → code='VALIDATION_ERROR', 422.
//   - NotFoundError → code='NOT_FOUND', 404, message='<resource> not found'.
//   - UnauthorizedError → 'UNAUTHORIZED', 401, default message 'Unauthorized'.
//   - ForbiddenError → 'FORBIDDEN', 403, default message 'Forbidden'.
//   - ConflictError → 'CONFLICT', 409.
//   - AppMismatchError → 'APP_MISMATCH', 403, message fijo.
//   - Todas heredan de AppError → instanceof AppError pasa.
//   - statusCode + code legibles desde el handler global de Fastify.

import { describe, it, expect } from 'vitest'
import {
  AppError, ValidationError, NotFoundError, UnauthorizedError,
  ForbiddenError, ConflictError, AppMismatchError,
} from '../errors.js'

// ── AppError base ────────────────────────────────────────────────────

describe('AppError (base)', () => {
  it('campos: code, message, statusCode default 500, details', () => {
    const err = new AppError('CUSTOM', 'something went wrong', 418, { x: 1 })
    expect(err.code).toBe('CUSTOM')
    expect(err.message).toBe('something went wrong')
    expect(err.statusCode).toBe(418)
    expect(err.details).toEqual({ x: 1 })
    expect(err.name).toBe('AppError')
  })

  it('statusCode default = 500 si no se pasa', () => {
    const err = new AppError('X', 'msg')
    expect(err.statusCode).toBe(500)
  })

  it('details opcional → undefined si no se pasa', () => {
    const err = new AppError('X', 'msg', 500)
    expect(err.details).toBeUndefined()
  })

  it('extiende Error → cumple instanceof Error', () => {
    const err = new AppError('X', 'msg')
    expect(err).toBeInstanceOf(Error)
  })
})

// ── ValidationError → 422 ────────────────────────────────────────────

describe('ValidationError', () => {
  it('code=VALIDATION_ERROR, statusCode=422, name=ValidationError', () => {
    const err = new ValidationError('bad input')
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.statusCode).toBe(422)
    expect(err.message).toBe('bad input')
    expect(err.name).toBe('ValidationError')
  })

  it('details propagan al constructor base', () => {
    const err = new ValidationError('bad', { field: 'email', issue: 'format' })
    expect(err.details).toEqual({ field: 'email', issue: 'format' })
  })

  it('instanceof AppError + Error', () => {
    const err = new ValidationError('x')
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
  })
})

// ── NotFoundError → 404 ──────────────────────────────────────────────

describe('NotFoundError', () => {
  it('code=NOT_FOUND, statusCode=404, message = "<resource> not found"', () => {
    const err = new NotFoundError('User')
    expect(err.code).toBe('NOT_FOUND')
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('User not found')
    expect(err.name).toBe('NotFoundError')
  })
})

// ── UnauthorizedError → 401 (default message) ────────────────────────

describe('UnauthorizedError', () => {
  it('default message = "Unauthorized", code=UNAUTHORIZED, statusCode=401', () => {
    const err = new UnauthorizedError()
    expect(err.message).toBe('Unauthorized')
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.statusCode).toBe(401)
  })
  it('message custom propaga', () => {
    const err = new UnauthorizedError('Token expired')
    expect(err.message).toBe('Token expired')
  })
})

// ── ForbiddenError → 403 (default message) ───────────────────────────

describe('ForbiddenError', () => {
  it('default = "Forbidden", code=FORBIDDEN, statusCode=403', () => {
    const err = new ForbiddenError()
    expect(err.message).toBe('Forbidden')
    expect(err.code).toBe('FORBIDDEN')
    expect(err.statusCode).toBe(403)
  })
  it('message custom propaga (e.g. "Only owner/admin")', () => {
    const err = new ForbiddenError('Only owner/admin can delete')
    expect(err.message).toBe('Only owner/admin can delete')
  })
})

// ── ConflictError → 409 ──────────────────────────────────────────────

describe('ConflictError', () => {
  it('code=CONFLICT, statusCode=409, mensaje obligatorio', () => {
    const err = new ConflictError('already exists')
    expect(err.code).toBe('CONFLICT')
    expect(err.statusCode).toBe(409)
    expect(err.message).toBe('already exists')
  })
})

// ── AppMismatchError → fijo 403 + message fijo ───────────────────────

describe('AppMismatchError', () => {
  it('code=APP_MISMATCH, statusCode=403, message fijo (no se parametriza)', () => {
    const err = new AppMismatchError()
    expect(err.code).toBe('APP_MISMATCH')
    expect(err.statusCode).toBe(403)
    expect(err.message).toBe('Token app_id does not match this service')
    expect(err.name).toBe('AppMismatchError')
  })
})

// ── Cross-cutting: handler-friendly shape ────────────────────────────

describe('handler integration', () => {
  it('Todos los errores tipados heredan de AppError (un solo catch sirve)', () => {
    expect(new ValidationError('x')).toBeInstanceOf(AppError)
    expect(new NotFoundError('x')).toBeInstanceOf(AppError)
    expect(new UnauthorizedError()).toBeInstanceOf(AppError)
    expect(new ForbiddenError()).toBeInstanceOf(AppError)
    expect(new ConflictError('x')).toBeInstanceOf(AppError)
    expect(new AppMismatchError()).toBeInstanceOf(AppError)
  })

  it('Todos exponen statusCode numérico válido (200-599)', () => {
    const errs = [
      new ValidationError('x'),
      new NotFoundError('R'),
      new UnauthorizedError(),
      new ForbiddenError(),
      new ConflictError('x'),
      new AppMismatchError(),
    ]
    for (const e of errs) {
      expect(typeof e.statusCode).toBe('number')
      expect(e.statusCode).toBeGreaterThanOrEqual(400)
      expect(e.statusCode).toBeLessThan(600)
    }
  })

  it('Stack trace incluye Error chain (debugging)', () => {
    const err = new NotFoundError('User')
    expect(err.stack).toBeDefined()
    expect(err.stack).toContain('NotFoundError')
  })
})
