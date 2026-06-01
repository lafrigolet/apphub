// utils/errors — re-export del SDK. Verifica que los constructores estén
// disponibles para los handlers del scheduler.
import { describe, it, expect } from 'vitest'
import {
  AppError, ValidationError, NotFoundError, UnauthorizedError, ConflictError, ForbiddenError,
} from '../utils/errors.js'

describe('errors re-export', () => {
  it('expone todas las clases de error del SDK', () => {
    for (const E of [AppError, ValidationError, NotFoundError, UnauthorizedError, ConflictError, ForbiddenError]) {
      expect(typeof E).toBe('function')
      expect(new E('x')).toBeInstanceOf(Error)
    }
  })
})
