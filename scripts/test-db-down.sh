#!/usr/bin/env bash
# Tear down the ephemeral test database (port 5433). Volume is tmpfs so this
# also wipes all data — no migrations or rows persist between runs.
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose -f docker-compose.test.yml down -v

echo "[test-db] torn down"
