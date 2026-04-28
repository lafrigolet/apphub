#!/bin/sh
# PID-1 entrypoint for the apphub NGINX container.
#
# Two responsibilities:
#   1. Run a one-shot "init" of the sidecar BEFORE NGINX starts: ensures Redis
#      contains the per-subdomain configs (seeding from /etc/nginx/seed if
#      empty) and renders them to /etc/nginx/conf.d/sites/.
#   2. Spawn the sidecar's "watch" loop in the background and exec NGINX in
#      the foreground. The sidecar polls Redis every 2s, hashes the contents,
#      re-renders + reloads NGINX when the hash changes.
set -e

/usr/local/bin/sidecar.sh init

/usr/local/bin/sidecar.sh watch &

exec nginx -g 'daemon off;'
