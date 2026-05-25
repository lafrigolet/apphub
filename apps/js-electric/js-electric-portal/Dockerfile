FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/js-electric/js-electric-portal/package.json ./apps/js-electric/js-electric-portal/package.json

RUN pnpm install --no-frozen-lockfile --filter @js-electric/js-electric-portal...

COPY apps/js-electric/js-electric-portal ./apps/js-electric/js-electric-portal

WORKDIR /app/apps/js-electric/js-electric-portal
EXPOSE 5180
CMD ["pnpm", "dev", "--host"]

FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/js-electric/js-electric-portal/package.json ./apps/js-electric/js-electric-portal/package.json

RUN pnpm install --frozen-lockfile --filter @js-electric/js-electric-portal...

COPY apps/js-electric/js-electric-portal ./apps/js-electric/js-electric-portal

RUN pnpm --filter @js-electric/js-electric-portal build

FROM nginx:alpine AS production
COPY --from=build /app/apps/js-electric/js-electric-portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/_health || exit 1
