FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json            ./packages/platform-sdk/package.json
COPY platform/orders/package.json                  ./platform/orders/package.json
COPY platform/inventory/package.json               ./platform/inventory/package.json
COPY platform/reviews/package.json                 ./platform/reviews/package.json
COPY platform/messaging/package.json               ./platform/messaging/package.json
COPY platform/shipping/package.json                ./platform/shipping/package.json
COPY platform/disputes/package.json                ./platform/disputes/package.json
COPY platform/catalog/package.json                 ./platform/catalog/package.json
COPY platform/basket/package.json                  ./platform/basket/package.json
COPY platform/marketplace/package.json             ./platform/marketplace/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-marketplace...

COPY packages/platform-sdk            ./packages/platform-sdk
COPY platform/orders/src              ./platform/orders/src
COPY platform/orders/migrations       ./platform/orders/migrations
COPY platform/inventory/src           ./platform/inventory/src
COPY platform/inventory/migrations    ./platform/inventory/migrations
COPY platform/reviews/src             ./platform/reviews/src
COPY platform/reviews/migrations      ./platform/reviews/migrations
COPY platform/messaging/src           ./platform/messaging/src
COPY platform/messaging/migrations    ./platform/messaging/migrations
COPY platform/shipping/src            ./platform/shipping/src
COPY platform/shipping/migrations     ./platform/shipping/migrations
COPY platform/disputes/src            ./platform/disputes/src
COPY platform/disputes/migrations     ./platform/disputes/migrations
COPY platform/catalog/src             ./platform/catalog/src
COPY platform/catalog/migrations      ./platform/catalog/migrations
COPY platform/basket/src              ./platform/basket/src
COPY platform/marketplace/src         ./platform/marketplace/src

WORKDIR /app/platform/marketplace
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json            ./packages/platform-sdk/package.json
COPY platform/orders/package.json                  ./platform/orders/package.json
COPY platform/inventory/package.json               ./platform/inventory/package.json
COPY platform/reviews/package.json                 ./platform/reviews/package.json
COPY platform/messaging/package.json               ./platform/messaging/package.json
COPY platform/shipping/package.json                ./platform/shipping/package.json
COPY platform/disputes/package.json                ./platform/disputes/package.json
COPY platform/catalog/package.json                 ./platform/catalog/package.json
COPY platform/basket/package.json                  ./platform/basket/package.json
COPY platform/marketplace/package.json             ./platform/marketplace/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-marketplace...

COPY packages/platform-sdk            ./packages/platform-sdk
COPY platform/orders/src              ./platform/orders/src
COPY platform/orders/migrations       ./platform/orders/migrations
COPY platform/inventory/src           ./platform/inventory/src
COPY platform/inventory/migrations    ./platform/inventory/migrations
COPY platform/reviews/src             ./platform/reviews/src
COPY platform/reviews/migrations      ./platform/reviews/migrations
COPY platform/messaging/src           ./platform/messaging/src
COPY platform/messaging/migrations    ./platform/messaging/migrations
COPY platform/shipping/src            ./platform/shipping/src
COPY platform/shipping/migrations     ./platform/shipping/migrations
COPY platform/disputes/src            ./platform/disputes/src
COPY platform/disputes/migrations     ./platform/disputes/migrations
COPY platform/catalog/src             ./platform/catalog/src
COPY platform/catalog/migrations      ./platform/catalog/migrations
COPY platform/basket/src              ./platform/basket/src
COPY platform/marketplace/src         ./platform/marketplace/src

WORKDIR /app/platform/marketplace
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node", "src/server.js"]
