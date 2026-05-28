import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as svc from '../services/solar-calculator.service.js'
import { ForbiddenError } from '@apphub/platform-sdk/errors'

const writeGuard   = requireRole('owner', 'admin', 'staff', 'super_admin')
const PLATFORM_ROLES = new Set(['staff', 'super_admin'])

// Cross-app guard. requireRole solo comprueba el role; aquí comprobamos
// que un owner/admin de aikikan NO pueda escribir en la config de
// js-electric. Los roles de plataforma (staff/super_admin) son universales.
function ensureSameApp(req) {
  const identityAppId = req.identity?.appId
  const role          = req.identity?.role
  if (PLATFORM_ROLES.has(role)) return
  if (identityAppId !== req.params.appId) {
    throw new ForbiddenError('app_id mismatch — no puedes editar la configuración de otro app')
  }
}

export async function solarCalculatorRoutes(fastify) {
  // GET público — el landing de cada app lo lee al montar la calculadora.
  // No filtra por tenant: la config vive en apps.metadata, no en tenants.
  fastify.get(
    '/v1/apps/:appId/solar-calculator',
    { config: { public: true } },
    async (req) => svc.getConfig(req.params.appId),
  )

  // PATCH solo admin del propio app (o platform staff). Replace completo —
  // el frontend siempre manda el snapshot entero, evita merges parciales
  // con shape inconsistente.
  fastify.patch(
    '/v1/apps/:appId/solar-calculator',
    { preHandler: writeGuard },
    async (req) => {
      ensureSameApp(req)
      const body = svc.solarCalculatorBody.parse(req.body)
      return svc.setConfig(req.params.appId, body)
    },
  )
}
