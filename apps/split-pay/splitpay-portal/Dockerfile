FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development
COPY apps/split-pay/splitpay-portal/package.json ./
COPY pnpm-workspace.yaml ./
COPY packages/ ./packages/
RUN pnpm install
COPY apps/split-pay/splitpay-portal/ .
CMD ["pnpm", "dev", "--host"]

FROM base AS production
ENV NODE_ENV=production
COPY apps/split-pay/splitpay-portal/package.json ./
COPY pnpm-workspace.yaml ./
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile
COPY apps/split-pay/splitpay-portal/ .
RUN pnpm build
FROM nginx:alpine
COPY --from=production /app/dist /usr/share/nginx/html
EXPOSE 5175
