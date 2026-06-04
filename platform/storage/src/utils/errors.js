import { AppError } from '@apphub/platform-sdk/errors'

export {
  AppError, ValidationError, NotFoundError, UnauthorizedError, ConflictError, ForbiddenError,
} from '@apphub/platform-sdk/errors'

// Tenant storage quota would be exceeded by the requested upload. 413 Payload
// Too Large is the closest HTTP semantic for "this would put you over budget".
export class QuotaExceededError extends AppError {
  constructor(message = 'storage quota exceeded', details) {
    super('STORAGE_QUOTA_EXCEEDED', message, 413, details)
  }
}
