FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY apps/split-pay/splitpay-core/package.json ./apps/split-pay/splitpay-core/package.json

RUN pnpm install --no-frozen-lockfile --filter @split-pay/splitpay-core...

COPY packages/platform-sdk ./packages/platform-sdk
COPY apps/split-pay/splitpay-core/src ./apps/split-pay/splitpay-core/src
COPY apps/split-pay/splitpay-core/migrations ./apps/split-pay/splitpay-core/migrations

WORKDIR /app/apps/split-pay/splitpay-core
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY apps/split-pay/splitpay-core/package.json ./apps/split-pay/splitpay-core/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @split-pay/splitpay-core...

COPY packages/platform-sdk ./packages/platform-sdk
COPY apps/split-pay/splitpay-core/src ./apps/split-pay/splitpay-core/src
COPY apps/split-pay/splitpay-core/migrations ./apps/split-pay/splitpay-core/migrations

WORKDIR /app/apps/split-pay/splitpay-core
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3020
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3020/health || exit 1
CMD ["node", "src/server.js"]
