import { createLogger } from '@apphub/platform-sdk/logger'
import { env } from './env.js'

export const logger = createLogger('platform-tpv', { level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV })
