FROM nginx:alpine

# redis-cli (from the redis package) is the protocol client used by the sidecar.
# tini handles PID 1 + child reaping. coreutils gives a robust sha256sum.
RUN apk add --no-cache redis tini coreutils

# Sidecar scripts and seed configs. Paths are relative to the REPO ROOT
# (build context = `.`) so the same Dockerfile works both with
# `docker compose build nginx` from the repo root AND with the CI/CD
# workflow which uses `context: .` uniformly for all services.
COPY infra/nginx/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY infra/nginx/sidecar.sh    /usr/local/bin/sidecar.sh
COPY infra/nginx/seed/         /etc/nginx/seed/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/sidecar.sh \
 && mkdir -p /etc/nginx/conf.d/sites

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
