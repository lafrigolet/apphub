import pino from 'pino'

export function createLogger(serviceName, opts = {}) {
  return pino({
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    transport:
      (opts.nodeEnv ?? process.env.NODE_ENV) === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    base: { service: serviceName },
  })
}
