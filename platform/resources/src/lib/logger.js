import { createLogger } from '@apphub/platform-sdk/logger'
import { env } from './env.js'
export const logger = createLogger('@apphub/platform-resources', { level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV })
