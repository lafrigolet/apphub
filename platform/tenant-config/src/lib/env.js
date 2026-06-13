import { z } from 'zod'
const envSchema = z.object({
  NODE_ENV:    z.enum(['development', 'test', 'production']).default('development'),
  PORT:        z.coerce.number().default(3005),
  DATABASE_URL:         z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:   z.string().url(),
  EXPECTED_APP_ID: z.string().default('platform'),
  LOG_LEVEL:   z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PLATFORM_CORE_URL: z.string().url().default('http://platform-core:3000'),
  // Base pública para construir el magic-link que se incrusta en el email
  // de bootstrap. Por defecto cae en aikikan.hulkstein.local en dev — el caller
  // override por subdomain real (https://<subdomain>.hulkstein.com).
  TENANT_PORTAL_BASE_URL: z.string().url().default('http://aikikan.hulkstein.local:8080'),
  // Colapso a un tenant por defecto: cada app nueva arranca con un super_admin
  // de plataforma (activación por email). Configurable; default acordado.
  PLATFORM_DEFAULT_SUPERADMIN_EMAIL: z.string().email().default('luisarturo.frigolet@gmail.com'),
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) { console.error(parsed.error.flatten().fieldErrors); process.exit(1) }
export const env = parsed.data
