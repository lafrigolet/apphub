FROM node:20-alpine AS base
RUN npm install -g pnpm@9 pm2
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY apps/yoga-studio/yoga-users/package.json    ./apps/yoga-studio/yoga-users/package.json
COPY apps/yoga-studio/yoga-classes/package.json  ./apps/yoga-studio/yoga-classes/package.json
COPY apps/yoga-studio/yoga-bookings/package.json ./apps/yoga-studio/yoga-bookings/package.json
COPY apps/yoga-studio/yoga-bonuses/package.json  ./apps/yoga-studio/yoga-bonuses/package.json
COPY apps/yoga-studio/yoga-reporting/package.json ./apps/yoga-studio/yoga-reporting/package.json
COPY apps/yoga-studio/yoga-portal/package.json   ./apps/yoga-studio/yoga-portal/package.json

RUN pnpm install --no-frozen-lockfile \
    --filter @yoga-studio/yoga-users \
    --filter @yoga-studio/yoga-classes \
    --filter @yoga-studio/yoga-bookings \
    --filter @yoga-studio/yoga-bonuses \
    --filter @yoga-studio/yoga-reporting \
    --filter @yoga-studio/yoga-portal

COPY packages/platform-sdk ./packages/platform-sdk

COPY apps/yoga-studio/yoga-users/src        ./apps/yoga-studio/yoga-users/src
COPY apps/yoga-studio/yoga-users/migrations ./apps/yoga-studio/yoga-users/migrations

COPY apps/yoga-studio/yoga-classes/src        ./apps/yoga-studio/yoga-classes/src
COPY apps/yoga-studio/yoga-classes/migrations ./apps/yoga-studio/yoga-classes/migrations

COPY apps/yoga-studio/yoga-bookings/src        ./apps/yoga-studio/yoga-bookings/src
COPY apps/yoga-studio/yoga-bookings/migrations ./apps/yoga-studio/yoga-bookings/migrations

COPY apps/yoga-studio/yoga-bonuses/src        ./apps/yoga-studio/yoga-bonuses/src
COPY apps/yoga-studio/yoga-bonuses/migrations ./apps/yoga-studio/yoga-bonuses/migrations

COPY apps/yoga-studio/yoga-reporting/src        ./apps/yoga-studio/yoga-reporting/src
COPY apps/yoga-studio/yoga-reporting/migrations ./apps/yoga-studio/yoga-reporting/migrations

COPY apps/yoga-studio/yoga-portal/src              ./apps/yoga-studio/yoga-portal/src
COPY apps/yoga-studio/yoga-portal/index.html       ./apps/yoga-studio/yoga-portal/index.html
COPY apps/yoga-studio/yoga-portal/vite.config.js   ./apps/yoga-studio/yoga-portal/vite.config.js
COPY apps/yoga-studio/yoga-portal/tailwind.config.js ./apps/yoga-studio/yoga-portal/tailwind.config.js
COPY apps/yoga-studio/yoga-portal/postcss.config.js  ./apps/yoga-studio/yoga-portal/postcss.config.js

COPY apps/yoga-studio/ecosystem.config.cjs ./apps/yoga-studio/ecosystem.config.cjs

EXPOSE 3011 3012 3013 3014 3017 5174

CMD ["pm2-runtime", "apps/yoga-studio/ecosystem.config.cjs"]
