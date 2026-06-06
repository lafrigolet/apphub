#!/usr/bin/env bash
# Despliega un subconjunto de servicios en el servidor de producción.
# Lo invoca .github/workflows/deploy.yml por SSH tras hacer push de las
# imágenes a GHCR.
#
# Pre-requisitos en el host:
#   - /home/deploy/apphub es un clone del repo (con `git fetch` ya hecho por
#     el workflow para sincronizar docker-compose.yml + infra/ + deploy/).
#   - .env vive en /home/deploy/apphub/.env (NO se versiona; lo gestiona el operador).
#   - $IMAGE_TAG está exportado (commit SHA o tag a desplegar).
#   - `docker login ghcr.io …` se ejecutó antes (lo hace el workflow).
#
# Uso:
#   IMAGE_TAG=<sha> ./deploy/server/deploy.sh platform-core aikikan-server
#
# Cuando se pasa una lista vacía → no hace nada (el workflow ya detectó
# que no hay cambios).
set -euo pipefail

cd "$(dirname "$0")/../.."

SERVICES=("$@")
if [[ ${#SERVICES[@]} -eq 0 ]]; then
  echo "deploy.sh: no services to deploy — exit 0"
  exit 0
fi

IMAGE_TAG="${IMAGE_TAG:-latest}"
export IMAGE_TAG

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo "═══ deploy ═══"
echo "  commit:   $IMAGE_TAG"
echo "  services: ${SERVICES[*]}"
echo

# Snapshot del estado antes para poder reportar qué cambió.
echo "── current state (before) ──"
$COMPOSE ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}' "${SERVICES[@]}" 2>/dev/null || true
echo

# Pull selectivo. Compose sólo descarga las imágenes de los servicios
# nombrados; infra (postgres/redis/minio) ni se toca.
echo "── pulling images ──"
$COMPOSE pull "${SERVICES[@]}"
echo

# `up -d` con servicios explícitos: Compose recrea sólo los que tienen
# imagen nueva. Los demás (incluidos depends_on) ya están corriendo y
# no se tocan. --no-deps evita que --force-recreate accidentalmente
# reinicie postgres si alguien declaró el depends_on con condition.
#
# --remove-orphans elimina los contenedores cuyo servicio YA NO EXISTE
# en el compose (p.ej. los 9 portales por-app tras consolidarlos en
# `portals`, ADR 017 — sin esto seguían corriendo para siempre). No
# afecta a servicios definidos-pero-no-levantados: esos no son huérfanos.
echo "── recreating containers ──"
$COMPOSE up -d --no-deps --remove-orphans "${SERVICES[@]}"
echo

# Healthchecks rápidos. Damos 20s a cada servicio para alcanzar
# "healthy" o "running"; si después de eso alguno no está OK, salimos
# con código ≠ 0 y el workflow falla. El operador investiga en
# logs/docker ps.
echo "── post-deploy healthchecks ──"
sleep 5
DEADLINE=$(( $(date +%s) + 20 ))
FAILED=()
for svc in "${SERVICES[@]}"; do
  STATUS=""
  while [[ $(date +%s) -lt $DEADLINE ]]; do
    STATUS=$($COMPOSE ps --format '{{.Status}}' "$svc" 2>/dev/null | head -1 || true)
    if echo "$STATUS" | grep -qE '\b(healthy|running|Up)\b'; then
      break
    fi
    sleep 2
  done
  printf '  %-30s %s\n' "$svc" "${STATUS:-(no status)}"
  if ! echo "$STATUS" | grep -qE '\b(healthy|running|Up)\b'; then
    FAILED+=("$svc")
  fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo
  echo "✗ deploy failed — services not healthy: ${FAILED[*]}" >&2
  echo "  Inspect with: docker compose logs --tail 200 ${FAILED[*]}" >&2
  exit 1
fi

echo
echo "✓ deploy ok — ${#SERVICES[@]} service(s) on commit $IMAGE_TAG"

# Limpieza opcional de imágenes viejas — sólo las dangling para no
# afectar a rollback rápido. Para purgar tags antiguos, el operador
# corre periódicamente `docker image prune -a --filter "until=336h"`.
docker image prune -f --filter "dangling=true" >/dev/null 2>&1 || true
