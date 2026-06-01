// utils/errors — subclases propias de splitpay (StripeError, IdempotencyConflictError).
import { describe, it, expect } from 'vitest'
import {
  AppError, StripeError, IdempotencyConflictError, NotFoundError,
} from '../utils/errors.js'

describe('StripeError', () => {
  it('code=STRIPE_ERROR, status 502, conserva details', () => {
    const cause = new Error('stripe boom')
    const err = new StripeError('Failed to do X', cause)
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('STRIPE_ERROR')
    expect(err.statusCode).toBe(502)
    expect(err.details).toBe(cause)
    expect(err.name).toBe('StripeError')
  })

  it('details opcional → undefined', () => {
    const err = new StripeError('x')
    expect(err.details).toBeUndefined()
  })
})

describe('IdempotencyConflictError', () => {
  it('code=IDEMPOTENCY_CONFLICT, status 409', () => {
    const err = new IdempotencyConflictError()
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(err.statusCode).toBe(409)
    expect(err.name).toBe('IdempotencyConflictError')
    expect(err.message).toMatch(/idempotency key/i)
  })
})

describe('re-exports SDK', () => {
  it('NotFoundError disponible desde utils/errors', () => {
    expect(new NotFoundError('Thing')).toBeInstanceOf(AppError)
  })
})
