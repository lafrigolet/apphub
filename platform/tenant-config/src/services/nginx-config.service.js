import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'

// The NGINX sidecar (infra/nginx/sidecar.sh) reads this hash and writes one
// .conf file per field into /etc/nginx/conf.d/sites/. Polling-based
// reconciliation: changes here are visible within POLL_INTERVAL seconds in
// every NGINX replica without filesystem coordination between nodes.
const CONF_KEY       = process.env.NGINX_CONF_KEY       ?? 'nginx:configs'
const RELOAD_CHANNEL = process.env.NGINX_RELOAD_CHANNEL ?? 'nginx:reload'

// The upstream alias (with concrete port) is defined statically in
// infra/nginx/conf.d/upstream.conf for every portal — convention:
// <subdomain_with_underscores>_portal. We just reference it here, so the
// rendered server block stays valid even when portals listen on different
// ports (5173, 5174, 5175, 5176, 5177, …).
const APP_TEMPLATE = `# Auto-generated for app {{app_id}} (subdomain: {{subdomain}}) at {{timestamp}}
# Source of truth: Redis hash field {{conf_key}}/{{subdomain}}.
server {
  listen 80;
  server_name {{subdomain}}.apphub.local {{subdomain}}.apphub.com;

  # Platform APIs (auth, tenants, payments, splitpay, …)
  include /etc/nginx/snippets/platform-routes.conf;

  # App frontend — proxies to the upstream block defined for this portal in
  # /etc/nginx/conf.d/upstream.conf. NGINX returns 502 until the container is up.
  location / {
    proxy_pass http://{{upstream_alias}};
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
`

function upstreamAlias(subdomain) {
  return `${String(subdomain).replace(/-/g, '_')}_portal`
}

function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{{${k}}}`,
  )
}

/**
 * Publish the NGINX server block for a newly-registered app. Writes the
 * rendered conf to Redis (HSET) and emits a PUBLISH for hot-aware sidecars.
 * Polling sidecars notice on the next tick regardless.
 */
export async function writeAppNginxConfig({ appId, subdomain }) {
  const conf = render(APP_TEMPLATE, {
    app_id:         appId,
    subdomain,
    upstream_alias: upstreamAlias(subdomain),
    conf_key:       CONF_KEY,
    timestamp:      new Date().toISOString(),
  })
  await redis.hset(CONF_KEY, subdomain, conf)
  await redis.publish(RELOAD_CHANNEL, subdomain).catch(() => {})
  logger.info({ subdomain, appId }, 'NGINX conf written to Redis; sidecars will reload')
}

/**
 * Drop the conf for a subdomain. Used when an app is deleted (no endpoint yet,
 * but the helper is here for when one is added).
 */
export async function deleteAppNginxConfig({ subdomain }) {
  await redis.hdel(CONF_KEY, subdomain)
  await redis.publish(RELOAD_CHANNEL, subdomain).catch(() => {})
  logger.info({ subdomain }, 'NGINX conf removed from Redis')
}
