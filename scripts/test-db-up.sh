#!/usr/bin/env bash
# Boot the ephemeral test postgres (port 5433) + redis (port 6380) used by
# integration tests. Idempotent: re-running with a healthy stack is a no-op.
#
# Use:
#   ./scripts/test-db-up.sh
#   INTEGRATION_REQUIRE_DB=true pnpm -r --filter './platform/*' run test:integration
#   ./scripts/test-db-down.sh
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose -f docker-compose.test.yml up -d --wait postgres-test redis-test

echo "[test-db] ready"
echo "  postgres → localhost:5433  (user=splitpay pass=splitpay db=splitpay)"
echo "  redis    → localhost:6380"
