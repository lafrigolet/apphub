#!/usr/bin/env bash
# Build de los portales en el HOST para el modo dev estático de `portals`
# (docker-compose.portals-static.yml). Genera apps/<portal>/dist/, que el
# contenedor nginx sirve por bind-mount — sin reconstruir la imagen Docker.
#
#   ./infra/portals/build-portals.sh                 # construye TODOS
#   ./infra/portals/build-portals.sh aikikan         # construye uno
#   ./infra/portals/build-portals.sh aikikan console # construye varios
#
# Las VITE_* replican el stage `build` del Dockerfile: API en RELATIVO
# (VITE_API_BASE_URL='') porque el portal se sirve detrás del gateway, que
# enruta /api/* por subdominio (igual que prod). Para aikikan se inyectan
# además las claves OAuth/tenant desde el entorno (o .env), de modo que el
# login funcione también en el modo estático de dev.
set -euo pipefail

# Repo root (este script vive en infra/portals/).
cd "$(dirname "$0")/../.."

# Carga .env si existe → expone GOOGLE_CLIENT_ID / FACEBOOK_APP_ID / AIKIKAN_TENANT_ID.
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

ALL="portal splitpay aikikan console tenant-console aulavera js-electric macabeo verifactu tpv luciapassardi"

build_portal() {
  case "$1" in
    portal)         pnpm --filter @splitpay/portal build ;;
    splitpay)       VITE_APP_ID=split-pay VITE_API_BASE_URL='' \
                      pnpm --filter @split-pay/splitpay-portal build ;;
    aikikan)        VITE_AIKIKAN_APP_ID=aikikan \
                    VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
                    VITE_FACEBOOK_APP_ID="${FACEBOOK_APP_ID:-}" \
                    VITE_AIKIKAN_TENANT_ID="${AIKIKAN_TENANT_ID:-}" \
                      pnpm --filter @aikikan/aikikan-portal build ;;
    console)        pnpm --filter @console/console-portal build ;;
    tenant-console) pnpm --filter @tenant-console/tenant-console-portal build ;;
    aulavera)       pnpm --filter @aulavera/aulavera-portal build ;;
    js-electric)    pnpm --filter @js-electric/js-electric-portal build ;;
    macabeo)        pnpm --filter @macabeo/macabeo-portal build ;;
    verifactu)      pnpm --filter @verifactu/verifactu-portal build ;;
    tpv)            pnpm --filter @tpv/tpv-portal build ;;
    luciapassardi)  pnpm --filter @luciapassardi/luciapassardi-portal build ;;
    *) echo "Portal desconocido: '$1'. Válidos: $ALL" >&2; exit 1 ;;
  esac
}

targets="${*:-$ALL}"
for p in $targets; do
  echo "▶ building portal: $p"
  build_portal "$p"
done
echo "✓ done — dist/ generado. Sirve con: docker compose -f docker-compose.yml -f docker-compose.portals-static.yml up -d"
