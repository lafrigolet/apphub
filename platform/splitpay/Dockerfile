FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/splitpay/package.json ./platform/splitpay/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-splitpay...

COPY packages/platform-sdk ./packages/platform-sdk
COPY platform/splitpay/src ./platform/splitpay/src
COPY platform/splitpay/migrations ./platform/splitpay/migrations

WORKDIR /app/platform/splitpay
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/splitpay/package.json ./platform/splitpay/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-splitpay...

COPY packages/platform-sdk ./packages/platform-sdk
COPY platform/splitpay/src ./platform/splitpay/src
COPY platform/splitpay/migrations ./platform/splitpay/migrations

WORKDIR /app/platform/splitpay
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3020
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3020/health || exit 1
CMD ["node", "src/server.js"]
