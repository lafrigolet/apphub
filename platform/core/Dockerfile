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
COPY platform/storage/package.json                 ./platform/storage/package.json
COPY platform/leads/package.json                   ./platform/leads/package.json
COPY platform/donations/package.json               ./platform/donations/package.json
COPY platform/inquiries/package.json               ./platform/inquiries/package.json
COPY platform/verifactu/package.json               ./platform/verifactu/package.json
COPY platform/chat/package.json                    ./platform/chat/package.json
COPY platform/tpv/package.json                     ./platform/tpv/package.json
COPY platform/commerce/package.json                ./platform/commerce/package.json
COPY platform/orders/package.json                  ./platform/orders/package.json
COPY platform/inventory/package.json               ./platform/inventory/package.json
COPY platform/reviews/package.json                 ./platform/reviews/package.json
COPY platform/messaging/package.json               ./platform/messaging/package.json
COPY platform/shipping/package.json                ./platform/shipping/package.json
COPY platform/disputes/package.json                ./platform/disputes/package.json
COPY platform/catalog/package.json                 ./platform/catalog/package.json
COPY platform/basket/package.json                  ./platform/basket/package.json
COPY platform/menu/package.json                    ./platform/menu/package.json
COPY platform/reservations/package.json            ./platform/reservations/package.json
COPY platform/floor-plan/package.json              ./platform/floor-plan/package.json
COPY platform/kds/package.json                     ./platform/kds/package.json
COPY platform/pos/package.json                     ./platform/pos/package.json
COPY platform/delivery-dispatch/package.json       ./platform/delivery-dispatch/package.json
COPY platform/services/package.json                ./platform/services/package.json
COPY platform/resources/package.json               ./platform/resources/package.json
COPY platform/bookings/package.json                ./platform/bookings/package.json
COPY platform/availability/package.json            ./platform/availability/package.json
COPY platform/intake-forms/package.json            ./platform/intake-forms/package.json
COPY platform/telehealth/package.json              ./platform/telehealth/package.json
COPY platform/packages/package.json                ./platform/packages/package.json
COPY platform/practitioner-payouts/package.json    ./platform/practitioner-payouts/package.json
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
COPY platform/storage/src             ./platform/storage/src
COPY platform/storage/migrations      ./platform/storage/migrations
COPY platform/leads/src               ./platform/leads/src
COPY platform/leads/migrations        ./platform/leads/migrations
COPY platform/donations/src           ./platform/donations/src
COPY platform/donations/migrations    ./platform/donations/migrations
COPY platform/inquiries/src           ./platform/inquiries/src
COPY platform/inquiries/migrations    ./platform/inquiries/migrations
COPY platform/verifactu/src           ./platform/verifactu/src
COPY platform/verifactu/migrations    ./platform/verifactu/migrations
COPY platform/chat/src                ./platform/chat/src
COPY platform/tpv/src                 ./platform/tpv/src
COPY platform/chat/migrations         ./platform/chat/migrations
COPY platform/tpv/migrations          ./platform/tpv/migrations
COPY platform/commerce/src            ./platform/commerce/src
COPY platform/commerce/migrations     ./platform/commerce/migrations
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
COPY platform/menu/src                ./platform/menu/src
COPY platform/menu/migrations         ./platform/menu/migrations
COPY platform/reservations/src        ./platform/reservations/src
COPY platform/reservations/migrations ./platform/reservations/migrations
COPY platform/floor-plan/src          ./platform/floor-plan/src
COPY platform/floor-plan/migrations   ./platform/floor-plan/migrations
COPY platform/kds/src                 ./platform/kds/src
COPY platform/kds/migrations          ./platform/kds/migrations
COPY platform/pos/src                 ./platform/pos/src
COPY platform/pos/migrations          ./platform/pos/migrations
COPY platform/delivery-dispatch/src        ./platform/delivery-dispatch/src
COPY platform/delivery-dispatch/migrations ./platform/delivery-dispatch/migrations
COPY platform/services/src            ./platform/services/src
COPY platform/services/migrations     ./platform/services/migrations
COPY platform/resources/src           ./platform/resources/src
COPY platform/resources/migrations    ./platform/resources/migrations
COPY platform/bookings/src            ./platform/bookings/src
COPY platform/bookings/migrations     ./platform/bookings/migrations
COPY platform/availability/src        ./platform/availability/src
COPY platform/availability/migrations ./platform/availability/migrations
COPY platform/intake-forms/src        ./platform/intake-forms/src
COPY platform/intake-forms/migrations ./platform/intake-forms/migrations
COPY platform/telehealth/src          ./platform/telehealth/src
COPY platform/telehealth/migrations   ./platform/telehealth/migrations
COPY platform/packages/src            ./platform/packages/src
COPY platform/packages/migrations     ./platform/packages/migrations
COPY platform/practitioner-payouts/src        ./platform/practitioner-payouts/src
COPY platform/practitioner-payouts/migrations ./platform/practitioner-payouts/migrations
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
COPY platform/storage/package.json                 ./platform/storage/package.json
COPY platform/leads/package.json                   ./platform/leads/package.json
COPY platform/donations/package.json               ./platform/donations/package.json
COPY platform/inquiries/package.json               ./platform/inquiries/package.json
COPY platform/verifactu/package.json               ./platform/verifactu/package.json
COPY platform/chat/package.json                    ./platform/chat/package.json
COPY platform/tpv/package.json                     ./platform/tpv/package.json
COPY platform/commerce/package.json                ./platform/commerce/package.json
COPY platform/orders/package.json                  ./platform/orders/package.json
COPY platform/inventory/package.json               ./platform/inventory/package.json
COPY platform/reviews/package.json                 ./platform/reviews/package.json
COPY platform/messaging/package.json               ./platform/messaging/package.json
COPY platform/shipping/package.json                ./platform/shipping/package.json
COPY platform/disputes/package.json                ./platform/disputes/package.json
COPY platform/catalog/package.json                 ./platform/catalog/package.json
COPY platform/basket/package.json                  ./platform/basket/package.json
COPY platform/menu/package.json                    ./platform/menu/package.json
COPY platform/reservations/package.json            ./platform/reservations/package.json
COPY platform/floor-plan/package.json              ./platform/floor-plan/package.json
COPY platform/kds/package.json                     ./platform/kds/package.json
COPY platform/pos/package.json                     ./platform/pos/package.json
COPY platform/delivery-dispatch/package.json       ./platform/delivery-dispatch/package.json
COPY platform/services/package.json                ./platform/services/package.json
COPY platform/resources/package.json               ./platform/resources/package.json
COPY platform/bookings/package.json                ./platform/bookings/package.json
COPY platform/availability/package.json            ./platform/availability/package.json
COPY platform/intake-forms/package.json            ./platform/intake-forms/package.json
COPY platform/telehealth/package.json              ./platform/telehealth/package.json
COPY platform/packages/package.json                ./platform/packages/package.json
COPY platform/practitioner-payouts/package.json    ./platform/practitioner-payouts/package.json
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
COPY platform/storage/src             ./platform/storage/src
COPY platform/storage/migrations      ./platform/storage/migrations
COPY platform/leads/src               ./platform/leads/src
COPY platform/leads/migrations        ./platform/leads/migrations
COPY platform/donations/src           ./platform/donations/src
COPY platform/donations/migrations    ./platform/donations/migrations
COPY platform/inquiries/src           ./platform/inquiries/src
COPY platform/inquiries/migrations    ./platform/inquiries/migrations
COPY platform/verifactu/src           ./platform/verifactu/src
COPY platform/verifactu/migrations    ./platform/verifactu/migrations
COPY platform/chat/src                ./platform/chat/src
COPY platform/tpv/src                 ./platform/tpv/src
COPY platform/chat/migrations         ./platform/chat/migrations
COPY platform/tpv/migrations          ./platform/tpv/migrations
COPY platform/commerce/src            ./platform/commerce/src
COPY platform/commerce/migrations     ./platform/commerce/migrations
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
COPY platform/menu/src                ./platform/menu/src
COPY platform/menu/migrations         ./platform/menu/migrations
COPY platform/reservations/src        ./platform/reservations/src
COPY platform/reservations/migrations ./platform/reservations/migrations
COPY platform/floor-plan/src          ./platform/floor-plan/src
COPY platform/floor-plan/migrations   ./platform/floor-plan/migrations
COPY platform/kds/src                 ./platform/kds/src
COPY platform/kds/migrations          ./platform/kds/migrations
COPY platform/pos/src                 ./platform/pos/src
COPY platform/pos/migrations          ./platform/pos/migrations
COPY platform/delivery-dispatch/src        ./platform/delivery-dispatch/src
COPY platform/delivery-dispatch/migrations ./platform/delivery-dispatch/migrations
COPY platform/services/src            ./platform/services/src
COPY platform/services/migrations     ./platform/services/migrations
COPY platform/resources/src           ./platform/resources/src
COPY platform/resources/migrations    ./platform/resources/migrations
COPY platform/bookings/src            ./platform/bookings/src
COPY platform/bookings/migrations     ./platform/bookings/migrations
COPY platform/availability/src        ./platform/availability/src
COPY platform/availability/migrations ./platform/availability/migrations
COPY platform/intake-forms/src        ./platform/intake-forms/src
COPY platform/intake-forms/migrations ./platform/intake-forms/migrations
COPY platform/telehealth/src          ./platform/telehealth/src
COPY platform/telehealth/migrations   ./platform/telehealth/migrations
COPY platform/packages/src            ./platform/packages/src
COPY platform/packages/migrations     ./platform/packages/migrations
COPY platform/practitioner-payouts/src        ./platform/practitioner-payouts/src
COPY platform/practitioner-payouts/migrations ./platform/practitioner-payouts/migrations
COPY platform/core/src                ./platform/core/src

WORKDIR /app/platform/core
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/bootstrap.js"]
