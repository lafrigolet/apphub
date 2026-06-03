import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL:           z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  // Secret used to verify the JWT presented on the WebSocket handshake. The
  // gateway can't rely on appGuard (browsers can't set Authorization on WS),
  // so it validates the signature itself. Falls back to PLATFORM_JWT_SECRET.
  PLATFORM_JWT_SECRET:    z.string().min(32).optional(),
  // Loopback to platform-core's own HTTP API — used to resolve app-role
  // mentions (@staff) via platform/auth's GET /v1/users (rule-13 pattern).
  PLATFORM_CORE_BASE_URL: z.string().url().default('http://localhost:3000'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-chat:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
