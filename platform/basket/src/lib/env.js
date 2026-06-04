import { z } from 'zod'
const envSchema = z.object({
  NODE_ENV:        z.enum(['development', 'test', 'production']).default('development'),
  PORT:            z.coerce.number().default(3004),
  REDIS_URL:       z.string().url(),
  EXPECTED_APP_ID: z.string().default('platform'),
  LOG_LEVEL:       z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  // Sliding TTL (seconds) applied to basket keys on every mutation. Guest
  // baskets get a shorter window than authenticated ones. A user is treated
  // as a guest when the caller passes `isGuest: true` (the client minted the
  // userId locally). 0 disables TTL for that class (key persists forever).
  BASKET_TTL_AUTH_SECONDS:  z.coerce.number().int().min(0).default(2_592_000), // 30d
  BASKET_TTL_GUEST_SECONDS: z.coerce.number().int().min(0).default(604_800),   // 7d
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) { console.error(parsed.error.flatten().fieldErrors); process.exit(1) }
export const env = parsed.data
