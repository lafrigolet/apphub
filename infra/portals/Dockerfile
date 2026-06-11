# ── Portals — imagen unificada de los 9 frontends (ADR 017) ──────────
#
# dev:  un contenedor, 9 procesos vite (HMR intacto), cada uno en su
#       puerto histórico (5173, 5175–5182) lanzados por dev-entrypoint.sh
#       con su VITE_* propio (el env de contenedor es compartido; el
#       per-portal va por proceso).
# prod: nginx-alpine sirviendo los 9 dist/ — un server block POR PUERTO
#       (mismos puertos que dev, así los upstreams del gateway son
#       idénticos en dev y prod). No se discrimina por Host: el gateway
#       ya elige el portal por server block (y tenant-console sirve
#       hosts dinámicos — ADR 012 — que un map estático rompería).

FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# Manifiestos del workspace + de cada portal (cache de capas: mientras no
# cambien los package.json, el install no se repite).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/portal/package.json                                  ./apps/portal/package.json
COPY apps/split-pay/splitpay-portal/package.json               ./apps/split-pay/splitpay-portal/package.json
COPY apps/aikikan/aikikan-portal/package.json                  ./apps/aikikan/aikikan-portal/package.json
COPY apps/console/console-portal/package.json                  ./apps/console/console-portal/package.json
COPY apps/tenant-console/tenant-console-portal/package.json    ./apps/tenant-console/tenant-console-portal/package.json
COPY apps/aulavera/aulavera-portal/package.json                ./apps/aulavera/aulavera-portal/package.json
COPY apps/js-electric/js-electric-portal/package.json          ./apps/js-electric/js-electric-portal/package.json
COPY apps/macabeo/macabeo-portal/package.json                  ./apps/macabeo/macabeo-portal/package.json
COPY apps/verifactu/verifactu-portal/package.json              ./apps/verifactu/verifactu-portal/package.json
COPY apps/tpv/tpv-portal/package.json                          ./apps/tpv/tpv-portal/package.json
# '*portal*' matchea los 9 paquetes (@splitpay/portal incluido) y nada más.
RUN pnpm install --no-frozen-lockfile --filter '*portal*...'

# ── Development ───────────────────────────────────────────────────────
FROM deps AS development
ENV NODE_ENV=development

COPY apps/portal                                ./apps/portal
COPY apps/split-pay/splitpay-portal             ./apps/split-pay/splitpay-portal
COPY apps/aikikan/aikikan-portal                ./apps/aikikan/aikikan-portal
COPY apps/console/console-portal                ./apps/console/console-portal
COPY apps/tenant-console/tenant-console-portal  ./apps/tenant-console/tenant-console-portal
COPY apps/aulavera/aulavera-portal              ./apps/aulavera/aulavera-portal
COPY apps/js-electric/js-electric-portal        ./apps/js-electric/js-electric-portal
COPY apps/macabeo/macabeo-portal                ./apps/macabeo/macabeo-portal
COPY apps/verifactu/verifactu-portal            ./apps/verifactu/verifactu-portal
COPY apps/tpv/tpv-portal                        ./apps/tpv/tpv-portal
COPY infra/portals/dev-entrypoint.sh /dev-entrypoint.sh
RUN chmod +x /dev-entrypoint.sh

EXPOSE 5173 5175 5176 5177 5178 5179 5180 5181 5182 5183
CMD ["/dev-entrypoint.sh"]

# ── Build (todos los dist/) ───────────────────────────────────────────
FROM deps AS build

COPY apps/portal                                ./apps/portal
COPY apps/split-pay/splitpay-portal             ./apps/split-pay/splitpay-portal
COPY apps/aikikan/aikikan-portal                ./apps/aikikan/aikikan-portal
COPY apps/console/console-portal                ./apps/console/console-portal
COPY apps/tenant-console/tenant-console-portal  ./apps/tenant-console/tenant-console-portal
COPY apps/aulavera/aulavera-portal              ./apps/aulavera/aulavera-portal
COPY apps/js-electric/js-electric-portal        ./apps/js-electric/js-electric-portal
COPY apps/macabeo/macabeo-portal                ./apps/macabeo/macabeo-portal
COPY apps/verifactu/verifactu-portal            ./apps/verifactu/verifactu-portal
COPY apps/tpv/tpv-portal                        ./apps/tpv/tpv-portal

# VITE_API_BASE_URL vacío → cada SPA llama /api/* en relativo y el gateway
# enruta por subdominio (mismo criterio que tenían los Dockerfiles
# individuales; splitpay además fija su VITE_APP_ID).
RUN pnpm --filter @splitpay/portal build \
 && VITE_APP_ID=split-pay VITE_API_BASE_URL='' pnpm --filter @split-pay/splitpay-portal build \
 && pnpm --filter @aikikan/aikikan-portal build \
 && pnpm --filter @console/console-portal build \
 && pnpm --filter @tenant-console/tenant-console-portal build \
 && pnpm --filter @aulavera/aulavera-portal build \
 && pnpm --filter @js-electric/js-electric-portal build \
 && pnpm --filter @macabeo/macabeo-portal build \
 && pnpm --filter @verifactu/verifactu-portal build \
 && pnpm --filter @tpv/tpv-portal build

# ── Production ────────────────────────────────────────────────────────
FROM nginx:alpine AS production
COPY --from=build /app/apps/portal/dist                                 /usr/share/nginx/html/portal
COPY --from=build /app/apps/split-pay/splitpay-portal/dist              /usr/share/nginx/html/splitpay
COPY --from=build /app/apps/aikikan/aikikan-portal/dist                 /usr/share/nginx/html/aikikan
COPY --from=build /app/apps/console/console-portal/dist                 /usr/share/nginx/html/console
COPY --from=build /app/apps/tenant-console/tenant-console-portal/dist   /usr/share/nginx/html/tenant-console
COPY --from=build /app/apps/aulavera/aulavera-portal/dist               /usr/share/nginx/html/aulavera
COPY --from=build /app/apps/js-electric/js-electric-portal/dist         /usr/share/nginx/html/js-electric
COPY --from=build /app/apps/macabeo/macabeo-portal/dist                 /usr/share/nginx/html/macabeo
COPY --from=build /app/apps/verifactu/verifactu-portal/dist             /usr/share/nginx/html/verifactu
COPY --from=build /app/apps/tpv/tpv-portal/dist                         /usr/share/nginx/html/tpv
COPY infra/portals/spa-locations.conf /etc/nginx/snippets/spa-locations.conf
COPY infra/portals/portals.conf       /etc/nginx/conf.d/default.conf
EXPOSE 5173 5175 5176 5177 5178 5179 5180 5181 5182 5183
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5173/_health || exit 1
