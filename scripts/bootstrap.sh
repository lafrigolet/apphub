#!/usr/bin/env bash
# scripts/bootstrap.sh — first-boot bootstrap of an empty AppHub platform.
#
# After a fresh `docker compose up` (or after wiping the database), the
# auth tables are empty so nobody can log in to voragine-console. This
# script creates the first super_admin user, optionally registers the
# "platform" app (used as the JWT app_id for staff), and verifies that
# login works end-to-end.
#
# Idempotent: re-running with the same credentials is a no-op.
#
# Usage:
#   ./scripts/bootstrap.sh                                 # interactive
#   BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_PASSWORD=… ./scripts/bootstrap.sh   # CI/automation
#
# Requires: bash, curl, python3 (for JSON parsing — already present in the
# base image of every dev machine that runs the rest of the stack).
set -euo pipefail

PLATFORM_CORE_URL="${PLATFORM_CORE_URL:-http://localhost:3000}"
# Convention: the staff console runs at voragine-console.apphub.local and
# its JWT app_id matches the subdomain. Both bootstrap.sh and the dev seed
# (apps/voragine-console/voragine-console-portal/scripts/seed.js) use this
# id, so they no longer collide on the unique subdomain constraint.
PLATFORM_APP_ID="${PLATFORM_APP_ID:-voragine-console}"
PLATFORM_TENANT_ID="${PLATFORM_TENANT_ID:-00000000-0000-0000-0000-000000000001}"
PLATFORM_TENANT_NAME="${PLATFORM_TENANT_NAME:-Platform Root}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-60}"

ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-}"

# ── helpers ────────────────────────────────────────────────────────────
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
info()  { printf '\033[1;36m→\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

require() { command -v "$1" >/dev/null 2>&1 || fail "requires $1 in PATH"; }
require curl
require python3

http_status() {
  # Last line of curl -w "\n%{http_code}" output
  printf '%s\n' "$1" | tail -n1
}
http_body() {
  printf '%s\n' "$1" | sed '$d'
}
json_get() {
  # json_get '.path.to.field' '<json>'
  printf '%s' "$2" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for part in '$1'.lstrip('.').split('.'):
        d = d.get(part) if isinstance(d, dict) else None
    print(d if d is not None else '')
except Exception:
    print('')
"
}

# ── 1. Wait for platform-core ──────────────────────────────────────────
info "waiting for platform-core at $PLATFORM_CORE_URL/health (up to ${WAIT_TIMEOUT}s)"
i=0
while ! curl -fsS "$PLATFORM_CORE_URL/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge "$WAIT_TIMEOUT" ]; then
    fail "platform-core not reachable. Is the stack up? Try: docker compose up -d"
  fi
  sleep 1
done
ok "platform-core is up"

# ── 2. Collect credentials ─────────────────────────────────────────────
if [ -z "$ADMIN_EMAIL" ]; then
  read -r -p "Super-admin email: " ADMIN_EMAIL
fi
[ -z "$ADMIN_EMAIL" ] && fail "email is required"

if [ -z "$ADMIN_PASSWORD" ]; then
  read -r -s -p "Super-admin password (min 8 chars): " ADMIN_PASSWORD
  echo
  read -r -s -p "Confirm password: " confirm
  echo
  [ "$ADMIN_PASSWORD" = "$confirm" ] || fail "passwords do not match"
fi
[ "${#ADMIN_PASSWORD}" -lt 8 ] && fail "password must be at least 8 chars"

# ── 3. Create super_admin user ─────────────────────────────────────────
info "creating super_admin user $ADMIN_EMAIL"

# Build the JSON body via python3 for safe quoting (handles passwords with
# special characters like ", ', \, $).
register_body=$(python3 -c "
import json, sys
print(json.dumps({
    'appId':    '$PLATFORM_APP_ID',
    'tenantId': '$PLATFORM_TENANT_ID',
    'email':    '$ADMIN_EMAIL',
    'password': sys.argv[1],
    'role':     'super_admin',
}))
" "$ADMIN_PASSWORD")

resp=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  "$PLATFORM_CORE_URL/v1/auth/register" \
  -d "$register_body")

case "$(http_status "$resp")" in
  201) ok "super_admin created" ;;
  409) warn "user $ADMIN_EMAIL already exists — leaving as-is" ;;
  *)   fail "register failed (HTTP $(http_status "$resp")): $(http_body "$resp")" ;;
esac

# ── 4. Verify login ────────────────────────────────────────────────────
info "verifying login"
login_body=$(python3 -c "
import json, sys
print(json.dumps({
    'appId':    '$PLATFORM_APP_ID',
    'tenantId': '$PLATFORM_TENANT_ID',
    'email':    '$ADMIN_EMAIL',
    'password': sys.argv[1],
}))
" "$ADMIN_PASSWORD")

resp=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  "$PLATFORM_CORE_URL/v1/auth/login" \
  -d "$login_body")

if [ "$(http_status "$resp")" != "200" ]; then
  fail "login failed (HTTP $(http_status "$resp")): $(http_body "$resp")
The user exists but the password did not match. Set BOOTSTRAP_ADMIN_PASSWORD
to the existing password, or wipe the user manually if you forgot it."
fi

token=$(json_get '.data.accessToken' "$(http_body "$resp")")
[ -z "$token" ] && fail "login response missing accessToken: $(http_body "$resp")"
ok "login successful (token len=${#token})"

# ── 5. Ensure 'platform' app exists in the registry ────────────────────
info "ensuring '$PLATFORM_APP_ID' app is registered"
resp=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $token" \
  "$PLATFORM_CORE_URL/v1/apps/$PLATFORM_APP_ID")

case "$(http_status "$resp")" in
  200) ok "'$PLATFORM_APP_ID' app already registered" ;;
  404)
    info "'$PLATFORM_APP_ID' app not found — creating it"
    create_body=$(python3 -c "
import json
print(json.dumps({
    'appId':       '$PLATFORM_APP_ID',
    'displayName': 'Voragine Console',
    'subdomain':   '$PLATFORM_APP_ID',
    'jwtAudience': '$PLATFORM_APP_ID',
}))
")
    resp=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      "$PLATFORM_CORE_URL/v1/apps" \
      -d "$create_body")
    case "$(http_status "$resp")" in
      201) ok "'$PLATFORM_APP_ID' app created" ;;
      409) warn "race: '$PLATFORM_APP_ID' app was created concurrently" ;;
      *)   fail "create app failed (HTTP $(http_status "$resp")): $(http_body "$resp")" ;;
    esac
    ;;
  *) fail "GET /v1/apps/$PLATFORM_APP_ID failed (HTTP $(http_status "$resp")): $(http_body "$resp")" ;;
esac

# ── 6. Done ────────────────────────────────────────────────────────────
cat <<EOF

🎉 Platform bootstrapped successfully.

Log in to voragine-console:
  via gateway:  http://voragine-console.apphub.local:8080
  via Vite dev: http://localhost:5177

  email:    $ADMIN_EMAIL
  password: (the password you just set)

Next steps:
  1. Open voragine-console and click the "Apps" tab in the staff sidebar.
  2. Click "Nueva app" — provisions the app, first tenant, admin user, and
     the NGINX server block via Redis (see docs/adr/003-dynamic-nginx-routing.md).
  3. The new <subdomain>.apphub.local routes /api/* automatically within ~2s.
EOF
