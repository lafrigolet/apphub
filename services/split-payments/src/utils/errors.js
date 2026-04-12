export class AppError extends Error {
  constructor(code, message, statusCode = 500, details = undefined) {
    super(message)
    this.code = code
    this.statusCode = statusCode
    this.details = details
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(message, details = undefined) {
    super('VALIDATION_ERROR', message, 422, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource) {
    super('NOT_FOUND', `${resource} not found`, 404)
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super('CONFLICT', message, 409)
    this.name = 'ConflictError'
  }
}

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
