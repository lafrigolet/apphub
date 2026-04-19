import { createLogger } from '@apphub/platform-sdk/logger'
import { env } from './env.js'
export const logger = createLogger('platform-basket', { level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV })
