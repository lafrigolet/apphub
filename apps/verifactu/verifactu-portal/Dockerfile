FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/verifactu/verifactu-portal/package.json ./apps/verifactu/verifactu-portal/package.json

RUN pnpm install --no-frozen-lockfile --filter @verifactu/verifactu-portal...

COPY apps/verifactu/verifactu-portal ./apps/verifactu/verifactu-portal

WORKDIR /app/apps/verifactu/verifactu-portal
EXPOSE 5182
CMD ["pnpm", "dev", "--host"]

FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/verifactu/verifactu-portal/package.json ./apps/verifactu/verifactu-portal/package.json

RUN pnpm install --frozen-lockfile --filter @verifactu/verifactu-portal...

COPY apps/verifactu/verifactu-portal ./apps/verifactu/verifactu-portal

RUN pnpm --filter @verifactu/verifactu-portal build

FROM nginx:alpine AS production
COPY --from=build /app/apps/verifactu/verifactu-portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/_health || exit 1
