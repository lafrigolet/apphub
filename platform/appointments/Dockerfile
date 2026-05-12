FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json                       ./packages/platform-sdk/package.json
COPY platform/services/package.json                           ./platform/services/package.json
COPY platform/resources/package.json                          ./platform/resources/package.json
COPY platform/bookings/package.json                           ./platform/bookings/package.json
COPY platform/availability/package.json                       ./platform/availability/package.json
COPY platform/intake-forms/package.json                       ./platform/intake-forms/package.json
COPY platform/telehealth/package.json                         ./platform/telehealth/package.json
COPY platform/packages/package.json                           ./platform/packages/package.json
COPY platform/practitioner-payouts/package.json               ./platform/practitioner-payouts/package.json
COPY platform/appointments/package.json                       ./platform/appointments/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-appointments...

COPY packages/platform-sdk                  ./packages/platform-sdk
COPY platform/services/src                  ./platform/services/src
COPY platform/services/migrations           ./platform/services/migrations
COPY platform/resources/src                 ./platform/resources/src
COPY platform/resources/migrations          ./platform/resources/migrations
COPY platform/bookings/src                  ./platform/bookings/src
COPY platform/bookings/migrations           ./platform/bookings/migrations
COPY platform/availability/src              ./platform/availability/src
COPY platform/availability/migrations       ./platform/availability/migrations
COPY platform/intake-forms/src              ./platform/intake-forms/src
COPY platform/intake-forms/migrations       ./platform/intake-forms/migrations
COPY platform/telehealth/src                ./platform/telehealth/src
COPY platform/telehealth/migrations         ./platform/telehealth/migrations
COPY platform/packages/src                  ./platform/packages/src
COPY platform/packages/migrations           ./platform/packages/migrations
COPY platform/practitioner-payouts/src      ./platform/practitioner-payouts/src
COPY platform/practitioner-payouts/migrations ./platform/practitioner-payouts/migrations
COPY platform/appointments/src              ./platform/appointments/src

WORKDIR /app/platform/appointments
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json                       ./packages/platform-sdk/package.json
COPY platform/services/package.json                           ./platform/services/package.json
COPY platform/resources/package.json                          ./platform/resources/package.json
COPY platform/bookings/package.json                           ./platform/bookings/package.json
COPY platform/availability/package.json                       ./platform/availability/package.json
COPY platform/intake-forms/package.json                       ./platform/intake-forms/package.json
COPY platform/telehealth/package.json                         ./platform/telehealth/package.json
COPY platform/packages/package.json                           ./platform/packages/package.json
COPY platform/practitioner-payouts/package.json               ./platform/practitioner-payouts/package.json
COPY platform/appointments/package.json                       ./platform/appointments/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-appointments...

COPY packages/platform-sdk                  ./packages/platform-sdk
COPY platform/services/src                  ./platform/services/src
COPY platform/services/migrations           ./platform/services/migrations
COPY platform/resources/src                 ./platform/resources/src
COPY platform/resources/migrations          ./platform/resources/migrations
COPY platform/bookings/src                  ./platform/bookings/src
COPY platform/bookings/migrations           ./platform/bookings/migrations
COPY platform/availability/src              ./platform/availability/src
COPY platform/availability/migrations       ./platform/availability/migrations
COPY platform/intake-forms/src              ./platform/intake-forms/src
COPY platform/intake-forms/migrations       ./platform/intake-forms/migrations
COPY platform/telehealth/src                ./platform/telehealth/src
COPY platform/telehealth/migrations         ./platform/telehealth/migrations
COPY platform/packages/src                  ./platform/packages/src
COPY platform/packages/migrations           ./platform/packages/migrations
COPY platform/practitioner-payouts/src      ./platform/practitioner-payouts/src
COPY platform/practitioner-payouts/migrations ./platform/practitioner-payouts/migrations
COPY platform/appointments/src              ./platform/appointments/src

WORKDIR /app/platform/appointments
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3300/health || exit 1
CMD ["node", "src/server.js"]
