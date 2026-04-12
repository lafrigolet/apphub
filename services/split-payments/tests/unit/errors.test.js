import { describe, it, expect } from 'vitest'
import {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
  StripeError,
  IdempotencyConflictError,
} from '../../src/utils/errors.js'

describe('AppError', () => {
  it('stores code, message and statusCode', () => {
    const err = new AppError('TEST_CODE', 'Test message', 418)
    expect(err.code).toBe('TEST_CODE')
    expect(err.message).toBe('Test message')
    expect(err.statusCode).toBe(418)
  })

  it('defaults statusCode to 500', () => {
    const err = new AppError('CODE', 'msg')
    expect(err.statusCode).toBe(500)
  })

  it('stores optional details', () => {
    const details = { field: 'name' }
    const err = new AppError('CODE', 'msg', 400, details)
    expect(err.details).toEqual(details)
  })

  it('is an instance of Error', () => {
    expect(new AppError('C', 'm')).toBeInstanceOf(Error)
  })
})

describe('ValidationError', () => {
  it('has code VALIDATION_ERROR and status 422', () => {
    const err = new ValidationError('bad input')
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.statusCode).toBe(422)
  })
})

describe('NotFoundError', () => {
  it('includes resource name in message', () => {
    const err = new NotFoundError('Payment')
    expect(err.message).toContain('Payment')
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
  })
})

describe('UnauthorizedError', () => {
  it('has status 401', () => {
    expect(new UnauthorizedError().statusCode).toBe(401)
  })

  it('uses default message when none provided', () => {
    expect(new UnauthorizedError().message).toBe('Unauthorized')
  })
})

describe('ConflictError', () => {
  it('has status 409', () => {
    expect(new ConflictError('duplicate').statusCode).toBe(409)
  })
})

describe('StripeError', () => {
  it('has status 502', () => {
    expect(new StripeError('stripe failed').statusCode).toBe(502)
  })
})

describe('IdempotencyConflictError', () => {
  it('has status 409', () => {
    expect(new IdempotencyConflictError().statusCode).toBe(409)
  })
})
