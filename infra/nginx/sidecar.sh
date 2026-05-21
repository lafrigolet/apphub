#!/bin/sh
# Apphub NGINX sidecar — Redis-backed dynamic config.
#
# Cluster-friendly model: every NGINX instance reads its per-subdomain
# server blocks from a single Redis hash (CONF_KEY). When platform-core
# registers a new app it writes the rendered .conf to that hash and (optionally)
# publishes to RELOAD_CHANNEL. Each NGINX sidecar polls the hash and, on
# change, re-renders /etc/nginx/conf.d/sites/ and triggers nginx -s reload.
#
# Subcommands:
#   init   — block until Redis is reachable (with timeout fallback), seed the
#            hash from /etc/nginx/seed/*.conf if empty, render to disk.
#   watch  — poll Redis every POLL_INTERVAL seconds; reload NGINX when the
#            sha256 of HGETALL(CONF_KEY) changes.
set -eu

REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
CONF_KEY="${CONF_KEY:-nginx:configs}"
SITES_DIR="${SITES_DIR:-/etc/nginx/conf.d/sites}"
SEED_DIR="${SEED_DIR:-/etc/nginx/seed}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"
INIT_WAIT_SECS="${INIT_WAIT_SECS:-30}"

mkdir -p "$SITES_DIR"

log()  { echo "[sidecar] $*" >&2; }
rcli() { redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" "$@"; }
ping_redis() { rcli PING >/dev/null 2>&1; }

# ──────────────────────────────────────────────────────────────────────────────
# wait_for_redis: bounded wait. Returns 0 if reachable, 1 if not.
wait_for_redis() {
  i=0
  while [ "$i" -lt "$INIT_WAIT_SECS" ]; do
    if ping_redis; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# seed_missing: for each .conf in the seed directory, HSET it into Redis only
# if that field is not present yet (HSETNX-like semantics — never overwrite
# entries that the platform may have customized at runtime). Runs on every
# init so that adding a new seed file (e.g. a new app) reliably reaches every
# cluster, not just empty ones.
seed_missing() {
  if [ ! -d "$SEED_DIR" ]; then return 0; fi
  for f in "$SEED_DIR"/*.conf; do
    [ -e "$f" ] || continue
    name=$(basename "$f" .conf)
    existing=$(rcli HEXISTS "$CONF_KEY" "$name")
    if [ "$existing" = "1" ]; then continue; fi
    rcli -x HSET "$CONF_KEY" "$name" < "$f" >/dev/null
    log "  seeded $name (was missing)"
  done
}

# render: write each Redis hash field to $SITES_DIR/<field>.conf and remove
# any stale .conf files no longer present in Redis.
render() {
  fields=$(rcli HKEYS "$CONF_KEY" 2>/dev/null || true)

  for name in $fields; do
    out="$SITES_DIR/$name.conf"
    rcli HGET "$CONF_KEY" "$name" > "$out"
  done

  # Remove orphaned files
  for f in "$SITES_DIR"/*.conf; do
    [ -e "$f" ] || continue
    base=$(basename "$f" .conf)
    found=0
    for k in $fields; do
      if [ "$base" = "$k" ]; then found=1; break; fi
    done
    if [ "$found" = "0" ]; then
      rm -f "$f"
      log "  removed $base.conf (no longer in Redis)"
    fi
  done
}

# config_hash: compact fingerprint of HGETALL output. Cheap to compute, used
# by the watch loop to detect any change without having to diff files.
config_hash() {
  rcli HGETALL "$CONF_KEY" 2>/dev/null | sha256sum | cut -c1-16
}

cmd_init() {
  log "init: waiting for Redis at $REDIS_HOST:$REDIS_PORT"
  if ! wait_for_redis; then
    log "Redis unreachable after ${INIT_WAIT_SECS}s — falling back to seed files"
    if [ -d "$SEED_DIR" ]; then
      cp "$SEED_DIR"/*.conf "$SITES_DIR/" 2>/dev/null || true
    fi
    return 0
  fi
  seed_missing
  render
  count=$(ls "$SITES_DIR"/*.conf 2>/dev/null | wc -l)
  log "init: rendered $count config(s) to $SITES_DIR"
}

cmd_watch() {
  last=""
  log "watch: polling $CONF_KEY every ${POLL_INTERVAL}s"
  while true; do
    if ping_redis; then
      cur=$(config_hash)
      if [ "$cur" != "$last" ]; then
        if [ -n "$last" ]; then
          log "watch: change detected (hash $last → $cur), re-rendering"
        fi
        render
        if nginx -t 2>/tmp/nginx-test.err; then
          # First iteration: nginx may not be running yet; reload only after start.
          if [ -f /run/nginx.pid ] && [ -n "$last" ]; then
            nginx -s reload && log "watch: nginx reloaded"
          fi
          last="$cur"
        else
          log "watch: config invalid, reload skipped:"
          cat /tmp/nginx-test.err >&2
        fi
      fi
    else
      log "watch: Redis unreachable, retrying in ${POLL_INTERVAL}s"
    fi
    sleep "$POLL_INTERVAL"
  done
}

case "${1:-}" in
  init)  cmd_init ;;
  watch) cmd_watch ;;
  *)     echo "usage: $0 {init|watch}" >&2; exit 1 ;;
esac
