FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json            ./packages/platform-sdk/package.json
COPY platform/auth/package.json                    ./platform/auth/package.json
COPY platform/notifications/package.json           ./platform/notifications/package.json
COPY platform/payments/package.json                ./platform/payments/package.json
COPY platform/tenant-config/package.json           ./platform/tenant-config/package.json
COPY platform/splitpay/package.json                ./platform/splitpay/package.json
COPY platform/core/package.json                    ./platform/core/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-core...

COPY packages/platform-sdk            ./packages/platform-sdk
COPY platform/auth/src                ./platform/auth/src
COPY platform/auth/migrations         ./platform/auth/migrations
COPY platform/notifications/src       ./platform/notifications/src
COPY platform/notifications/migrations ./platform/notifications/migrations
COPY platform/payments/src            ./platform/payments/src
COPY platform/payments/migrations     ./platform/payments/migrations
COPY platform/tenant-config/src       ./platform/tenant-config/src
COPY platform/tenant-config/migrations ./platform/tenant-config/migrations
COPY platform/splitpay/src            ./platform/splitpay/src
COPY platform/splitpay/migrations     ./platform/splitpay/migrations
COPY platform/core/src                ./platform/core/src

WORKDIR /app/platform/core
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json            ./packages/platform-sdk/package.json
COPY platform/auth/package.json                    ./platform/auth/package.json
COPY platform/notifications/package.json           ./platform/notifications/package.json
COPY platform/payments/package.json                ./platform/payments/package.json
COPY platform/tenant-config/package.json           ./platform/tenant-config/package.json
COPY platform/splitpay/package.json                ./platform/splitpay/package.json
COPY platform/core/package.json                    ./platform/core/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-core...

COPY packages/platform-sdk            ./packages/platform-sdk
COPY platform/auth/src                ./platform/auth/src
COPY platform/auth/migrations         ./platform/auth/migrations
COPY platform/notifications/src       ./platform/notifications/src
COPY platform/notifications/migrations ./platform/notifications/migrations
COPY platform/payments/src            ./platform/payments/src
COPY platform/payments/migrations     ./platform/payments/migrations
COPY platform/tenant-config/src       ./platform/tenant-config/src
COPY platform/tenant-config/migrations ./platform/tenant-config/migrations
COPY platform/splitpay/src            ./platform/splitpay/src
COPY platform/splitpay/migrations     ./platform/splitpay/migrations
COPY platform/core/src                ./platform/core/src

WORKDIR /app/platform/core
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "src/server.js"]
