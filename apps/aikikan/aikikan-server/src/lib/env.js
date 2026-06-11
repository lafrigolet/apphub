import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  PORT:                   z.coerce.number().default(3030),
  // Opcional desde ADR 018: hospedado en apps-servers el Pool lo inyecta el
  // orquestador (DATABASE_URL_AIKIKAN); solo el modo standalone lo necesita.
  DATABASE_URL:           z.string().url().optional(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:              z.string().url(),
  PLATFORM_JWT_SECRET:    z.string().min(32),
  EXPECTED_APP_ID:        z.string().default('aikikan'),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Pagos — aikikan delega en `splitpay` (módulo de platform-core). Las
  // credenciales de Stripe viven exclusivamente en splitpay; aikikan solo
  // necesita la URL interna del platform-core para hacer la llamada
  // loopback al crear sesiones de checkout.
  //   SPLITPAY_BASE_URL:  http://platform-core:3000 (red docker)
  //   AIKIKAN_PUBLIC_URL: https://aikikan.es (para success_url/cancel_url)
  SPLITPAY_BASE_URL:  z.string().url().default('http://platform-core:3000'),
  AIKIKAN_PUBLIC_URL: z.string().url().optional(),
  // URL interna de platform-core para loopback al módulo storage
  // (download-url presigned de certificados). En la red docker apunta
  // al mismo host que SPLITPAY_BASE_URL — env separado por claridad
  // de intención.
  PLATFORM_CORE_URL:  z.string().url().default('http://platform-core:3000'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
