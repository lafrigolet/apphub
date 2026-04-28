// Re-export the canonical AppError + common subclasses from platform-sdk so
// errors thrown inside the splitpay module are recognised by the root error
// handler in platform-core (instanceof checks rely on identity).
export {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
} from '@apphub/platform-sdk/errors'

import { AppError } from '@apphub/platform-sdk/errors'

export class StripeError extends AppError {
  constructor(message, details = undefined) {
    super('STRIPE_ERROR', message, 502, details)
    this.name = 'StripeError'
  }
}

export class IdempotencyConflictError extends AppError {
  constructor() {
    super('IDEMPOTENCY_CONFLICT', 'A different request with this idempotency key already exists', 409)
    this.name = 'IdempotencyConflictError'
  }
}
