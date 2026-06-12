#!/bin/sh
# Arranca los 9 vite dev servers en un solo contenedor (ADR 017).
#
# El env de contenedor es COMPARTIDO entre procesos, pero cada portal
# necesita su propio VITE_API_BASE_URL (apunta a su subdominio del
# gateway). Por eso el per-portal se inyecta aquí, por proceso — los
# valores replican los que tenía cada servicio en docker-compose.yml y
# son sobreescribibles vía env del contenedor.
#
# El puerto de cada vite viene de su vite.config.js (5173, 5175–5182);
# --host hace que escuchen en 0.0.0.0 dentro del contenedor.
set -e
cd /app

GW="${PORTALS_GATEWAY_BASE:-hulkstein.local:8080}"

VITE_API_BASE_URL="http://${GW}" \
  pnpm --filter @splitpay/portal exec vite --host &

VITE_APP_ID=split-pay \
VITE_API_BASE_URL="http://splitpay.${GW}" \
  pnpm --filter @split-pay/splitpay-portal exec vite --host &

VITE_API_BASE_URL="http://aikikan.${GW}" \
VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
VITE_FACEBOOK_APP_ID="${FACEBOOK_APP_ID:-}" \
VITE_AIKIKAN_APP_ID=aikikan \
VITE_AIKIKAN_TENANT_ID="${AIKIKAN_TENANT_ID:-}" \
  pnpm --filter @aikikan/aikikan-portal exec vite --host &

pnpm --filter @console/console-portal exec vite --host &

pnpm --filter @tenant-console/tenant-console-portal exec vite --host &

VITE_API_BASE_URL="http://aulavera.${GW}" \
  pnpm --filter @aulavera/aulavera-portal exec vite --host &

VITE_API_BASE_URL="http://js-electric.${GW}" \
  pnpm --filter @js-electric/js-electric-portal exec vite --host &

VITE_API_BASE_URL="http://macabeo.${GW}" \
  pnpm --filter @macabeo/macabeo-portal exec vite --host &

VITE_API_BASE_URL="http://verifactu.${GW}" \
  pnpm --filter @verifactu/verifactu-portal exec vite --host &

# tpv-portal usa /api relativo (no necesita VITE_API_BASE_URL).
pnpm --filter @tpv/tpv-portal exec vite --host &

# luciapassardi: landing estática, sin llamadas a /api (contacto directo).
pnpm --filter @luciapassardi/luciapassardi-portal exec vite --host &

wait
