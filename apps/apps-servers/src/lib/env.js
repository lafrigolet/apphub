import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  APPS_SERVERS_PORT:      z.coerce.number().default(3030),
  MIGRATION_DATABASE_URL: z.string().url(),
  REDIS_URL:              z.string().url(),
  PLATFORM_JWT_SECRET:    z.string().min(32),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  ALLOWED_ORIGINS:        z.string().optional(),

  // Un Pool por app, cada uno ligado a su rol dedicado svc_app_<app>.
  // OJO: NO se define EXPECTED_APP_ID — el guard va por scope dentro de
  // cada módulo (makeAppGuardHook) y los env.js de cada app usan su
  // default propio ('aikikan' / 'aulavera').
  DATABASE_URL_AIKIKAN:   z.string().url(),
  DATABASE_URL_AULAVERA:  z.string().url(),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for apps-servers:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
