import type { Request, Response, NextFunction } from 'express'
import { UnauthorizedError } from '../utils/errors.js'
import type { TenantContext } from '../types/index.js'

declare global {
  namespace Express {
    interface Request {
      tenant: TenantContext
    }
  }
}

/**
 * Extracts tenant_id and sub_tenant_id from the Authorization JWT.
 * In production this should verify the JWT signature using JWT_SECRET.
 * For now it decodes the payload (base64) without verification for development.
 */
export function tenantMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing Authorization header')
  }

  const token = authHeader.slice(7)

  try {
    // Decode JWT payload (second segment)
    const payloadB64 = token.split('.')[1]
    if (!payloadB64) throw new Error('Invalid token format')

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      tenant_id?: string
      sub_tenant_id?: string | null
      exp?: number
    }

    if (!payload.tenant_id) {
      throw new UnauthorizedError('Token missing tenant_id claim')
    }

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedError('Token expired')
    }

    req.tenant = {
      tenantId: payload.tenant_id,
      subTenantId: payload.sub_tenant_id ?? null,
    }

    next()
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err
    throw new UnauthorizedError('Invalid token')
  }
}
