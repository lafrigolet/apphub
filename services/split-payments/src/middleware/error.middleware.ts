import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import Stripe from 'stripe'
import { AppError, ValidationError, StripeError } from '../utils/errors.js'
import { logger } from '../lib/logger.js'
import type { ApiError } from '../types/index.js'

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // Zod validation errors
  if (err instanceof ZodError) {
    const response: ApiError = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.flatten().fieldErrors,
      },
    }
    res.status(422).json(response)
    return
  }

  // Stripe API errors
  if (err instanceof Stripe.errors.StripeError) {
    logger.warn({ stripeCode: err.code, message: err.message }, 'Stripe API error')
    const appErr = new StripeError(err.message, { stripeCode: err.code, type: err.type })
    const response: ApiError = {
      error: { code: appErr.code, message: appErr.message, details: appErr.details },
    }
    res.status(appErr.statusCode).json(response)
    return
  }

  // Our typed application errors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, code: err.code }, err.message)
    } else {
      logger.warn({ code: err.code, message: err.message }, 'Client error')
    }
    const response: ApiError = {
      error: { code: err.code, message: err.message, details: err.details },
    }
    res.status(err.statusCode).json(response)
    return
  }

  // Unknown errors
  logger.error({ err }, 'Unhandled error')
  const response: ApiError = {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  }
  res.status(500).json(response)
}

/**
 * Wraps an async route handler so errors are forwarded to Express error handler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next)
  }
}
