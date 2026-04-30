FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json                    ./packages/platform-sdk/package.json
COPY platform/menu/package.json                            ./platform/menu/package.json
COPY platform/reservations/package.json                    ./platform/reservations/package.json
COPY platform/floor-plan/package.json                      ./platform/floor-plan/package.json
COPY platform/kds/package.json                             ./platform/kds/package.json
COPY platform/pos/package.json                             ./platform/pos/package.json
COPY platform/delivery-dispatch/package.json               ./platform/delivery-dispatch/package.json
COPY platform/restaurant/package.json                      ./platform/restaurant/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-restaurant...

COPY packages/platform-sdk             ./packages/platform-sdk
COPY platform/menu/src                 ./platform/menu/src
COPY platform/menu/migrations          ./platform/menu/migrations
COPY platform/reservations/src         ./platform/reservations/src
COPY platform/reservations/migrations  ./platform/reservations/migrations
COPY platform/floor-plan/src           ./platform/floor-plan/src
COPY platform/floor-plan/migrations    ./platform/floor-plan/migrations
COPY platform/kds/src                  ./platform/kds/src
COPY platform/kds/migrations           ./platform/kds/migrations
COPY platform/pos/src                  ./platform/pos/src
COPY platform/pos/migrations           ./platform/pos/migrations
COPY platform/delivery-dispatch/src    ./platform/delivery-dispatch/src
COPY platform/delivery-dispatch/migrations ./platform/delivery-dispatch/migrations
COPY platform/restaurant/src           ./platform/restaurant/src

WORKDIR /app/platform/restaurant
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json                    ./packages/platform-sdk/package.json
COPY platform/menu/package.json                            ./platform/menu/package.json
COPY platform/reservations/package.json                    ./platform/reservations/package.json
COPY platform/floor-plan/package.json                      ./platform/floor-plan/package.json
COPY platform/kds/package.json                             ./platform/kds/package.json
COPY platform/pos/package.json                             ./platform/pos/package.json
COPY platform/delivery-dispatch/package.json               ./platform/delivery-dispatch/package.json
COPY platform/restaurant/package.json                      ./platform/restaurant/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-restaurant...

COPY packages/platform-sdk             ./packages/platform-sdk
COPY platform/menu/src                 ./platform/menu/src
COPY platform/menu/migrations          ./platform/menu/migrations
COPY platform/reservations/src         ./platform/reservations/src
COPY platform/reservations/migrations  ./platform/reservations/migrations
COPY platform/floor-plan/src           ./platform/floor-plan/src
COPY platform/floor-plan/migrations    ./platform/floor-plan/migrations
COPY platform/kds/src                  ./platform/kds/src
COPY platform/kds/migrations           ./platform/kds/migrations
COPY platform/pos/src                  ./platform/pos/src
COPY platform/pos/migrations           ./platform/pos/migrations
COPY platform/delivery-dispatch/src    ./platform/delivery-dispatch/src
COPY platform/delivery-dispatch/migrations ./platform/delivery-dispatch/migrations
COPY platform/restaurant/src           ./platform/restaurant/src

WORKDIR /app/platform/restaurant
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3200/health || exit 1
CMD ["node", "src/server.js"]
