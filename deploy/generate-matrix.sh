#!/usr/bin/env bash
# Calcula qué servicios necesitan rebuild comparando el árbol actual
# contra una referencia git (BASE_REF). Lee deploy/services.json como
# source-of-truth; cruza cada servicio con git diff y emite una matriz
# JSON consumible por GitHub Actions `strategy.matrix.include`.
#
# Uso:
#   BASE_REF=<sha o ref> deploy/generate-matrix.sh
#
# Output (stdout, una línea):
#   {"include":[{"name":"platform-core","dockerfile":"platform/core/Dockerfile"}, …]}
#
# Para usar dentro de un workflow:
#   - run: |
#       matrix=$(BASE_REF="${{ github.event.before }}" deploy/generate-matrix.sh)
#       echo "matrix=$matrix" >> "$GITHUB_OUTPUT"
#
# Si BASE_REF no se puede resolver (e.g. primer push, force-push) o el
# diff incluye un fichero "no clasificable" (e.g. deploy/services.json),
# por seguridad emite TODOS los servicios — preferimos un deploy completo
# sobre uno parcial incompleto.
set -euo pipefail

cd "$(dirname "$0")/.."

BASE_REF="${BASE_REF:-}"
SERVICES_JSON="deploy/services.json"

if [[ ! -f "$SERVICES_JSON" ]]; then
  echo "services.json not found at $SERVICES_JSON" >&2
  exit 1
fi

# Si no hay BASE_REF resoluble → full rebuild como red de seguridad.
if [[ -z "$BASE_REF" ]] || ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "BASE_REF empty or unresolvable; emitting full matrix" >&2
  jq -c '{ include: [.services[] | {name, dockerfile, context: (.context // ".")}] }' "$SERVICES_JSON"
  exit 0
fi

# Lista de ficheros cambiados.
CHANGED_FILES=$(git diff --name-only "$BASE_REF" HEAD || true)
if [[ -z "$CHANGED_FILES" ]]; then
  echo "No changed files; emitting empty matrix" >&2
  echo '{"include":[]}'
  exit 0
fi

# Cambios al propio deploy/ → rebuild completo (mejor pasarse).
if echo "$CHANGED_FILES" | grep -qE '^deploy/services\.json$|^deploy/generate-matrix\.sh$'; then
  echo "deploy/services.json or generate-matrix.sh changed; emitting full matrix" >&2
  jq -c '{ include: [.services[] | {name, dockerfile, context: (.context // ".")}] }' "$SERVICES_JSON"
  exit 0
fi

# Helper: convierte un glob estilo gitignore (foo/**, bar/file.x) en una
# regex anclada a inicio de línea. ** = cualquier cosa; * = no-slash.
#
# Bug previo: hacer `** → .*` y luego `* → [^/]*` reemplazaba el `*` que
# ya forma parte del `.*`, transformándolo en `.[^/]*` y rompiendo el
# match para paths con subdirectorios. Solución: usar un sentinel para
# marcar el `**` antes de tocar el `*` single.
glob_to_regex() {
  local g="$1"
  # 1. Escape regex specials except *, /, %.
  g=$(printf '%s' "$g" | sed -E 's/[.+(){}|^$\[\]]/\\&/g')
  # 2. Marca `**` con un sentinel improbable.
  g=$(printf '%s' "$g" | sed 's|\*\*|%%DOUBLESTAR%%|g')
  # 3. `*` (single) → `[^/]*` — sin tocar el sentinel.
  g=$(printf '%s' "$g" | sed 's|\*|[^/]*|g')
  # 4. Restaura el sentinel como `.*`.
  g=$(printf '%s' "$g" | sed 's|%%DOUBLESTAR%%|.*|g')
  printf '^%s$' "$g"
}

# Para cada servicio: ¿algún path coincide con algún CHANGED_FILE?
INCLUDE=$(
  jq -c '.services[]' "$SERVICES_JSON" | while read -r svc; do
    name=$(echo "$svc"       | jq -r '.name')
    dockerfile=$(echo "$svc" | jq -r '.dockerfile')
    # context default = '.' (raíz del repo). nginx y otros futuros que
    # bindeen su propio subdirectorio lo declaran explícitamente.
    context=$(echo "$svc"    | jq -r '.context // "."')
    matched="false"
    while read -r pattern; do
      [[ -z "$pattern" ]] && continue
      rx=$(glob_to_regex "$pattern")
      if echo "$CHANGED_FILES" | grep -qE "$rx"; then
        matched="true"
        break
      fi
    done < <(echo "$svc" | jq -r '.paths[]')
    if [[ "$matched" == "true" ]]; then
      jq -nc --arg name "$name" --arg df "$dockerfile" --arg ctx "$context" \
        '{name: $name, dockerfile: $df, context: $ctx}'
    fi
  done | jq -sc '.'
)

jq -nc --argjson include "$INCLUDE" '{ include: $include }'
