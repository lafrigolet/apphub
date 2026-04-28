FROM nginx:alpine

# redis-cli (from the redis package) is the protocol client used by the sidecar.
# tini handles PID 1 + child reaping. coreutils gives a robust sha256sum.
RUN apk add --no-cache redis tini coreutils

# Sidecar scripts and seed configs (the latter populate Redis on first boot
# when the hash is empty; afterwards Redis is the source of truth).
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY sidecar.sh    /usr/local/bin/sidecar.sh
COPY seed/         /etc/nginx/seed/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/sidecar.sh \
 && mkdir -p /etc/nginx/conf.d/sites

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
