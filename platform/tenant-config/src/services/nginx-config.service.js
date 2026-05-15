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
{{server_route_block}}
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

// Bloque opcional /api/<appId>/ → <upstream>_server. Sólo lo añadimos
// cuando la app trae un servidor backend (ADR 013). El upstream se
// declara estáticamente en infra/nginx/conf.d/upstream.conf — si no
// existe, NGINX da 502 y el operador sabe que falta wirearlo.
const SERVER_ROUTE_TEMPLATE = `
  # App-specific backend (ADR 013 — one container per app, schema app_{{app_id}}).
  # Ej.: GET /api/{{app_id}}/dojos → /v1/{{app_id}}/dojos.
  location /api/{{app_id}}/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://{{server_upstream_alias}}/v1/{{app_id}}/;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
  }
`

function portalUpstreamAlias(subdomain) {
  return `${String(subdomain).replace(/-/g, '_')}_portal`
}

function serverUpstreamAlias(appId) {
  return `${String(appId).replace(/-/g, '_')}_server`
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
export async function writeAppNginxConfig({ appId, subdomain, hasServer = false }) {
  // hasServer=false por defecto: el wizard de bootstrap crea apps que
  // suelen empezar sólo con portal. Cuando la app gana un backend
  // propio (vía "Implementa <app>"), el caller invoca este helper con
  // hasServer:true y se añade la ruta /api/<appId>/ al server block.
  // Si declaramos la ruta sin que exista el upstream, nginx falla a
  // recargar — por eso opt-in explícito.
  const serverRouteBlock = hasServer
    ? render(SERVER_ROUTE_TEMPLATE, {
        app_id:                appId,
        server_upstream_alias: serverUpstreamAlias(appId),
      })
    : ''
  const conf = render(APP_TEMPLATE, {
    app_id:             appId,
    subdomain,
    upstream_alias:     portalUpstreamAlias(subdomain),
    server_route_block: serverRouteBlock,
    conf_key:           CONF_KEY,
    timestamp:          new Date().toISOString(),
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

// Per-tenant template — every tenant subdomain proxies to the *same*
// tenant-console upstream; the tenant-console figures out which tenant it
// is from the JWT (app_id + tenant_id claims). The Host header is preserved
// so the shell can also derive the subdomain client-side for sanity checks.
const TENANT_TEMPLATE = `# Auto-generated for tenant {{tenant_id}} (subdomain: {{subdomain}}) at {{timestamp}}
# Source of truth: Redis hash field {{conf_key}}/tenant--{{subdomain}}.
server {
  listen 80;
  server_name {{subdomain}}.apphub.local {{subdomain}}.apphub.com;

  # Same platform APIs every other portal exposes.
  include /etc/nginx/snippets/platform-routes.conf;

  # Tenant Console frontend — shared upstream for all tenants.
  location / {
    proxy_pass http://tenant_console_portal;
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

// Tenant subdomains share the global Redis hash with app subdomains; we
// namespace keys with a `tenant--` prefix so app + tenant subdomain spaces
// can't collide. (App subdomains are top-level subdomains of the platform
// itself: aikikan, splitpay, …; tenant subdomains are per-customer.)
function tenantConfKey(subdomain) {
  return `tenant--${subdomain}`
}

/**
 * Publish the NGINX server block for a newly-registered tenant. Idempotent —
 * called on tenant create AND on platform-core boot for every existing
 * tenant (backfill), so a brand-new infra without seeded Redis ends up with
 * the right map after first boot.
 */
export async function writeTenantNginxConfig({ tenantId, subdomain }) {
  if (!subdomain) {
    logger.warn({ tenantId }, 'Tenant has no subdomain — skipping NGINX conf')
    return
  }
  const conf = render(TENANT_TEMPLATE, {
    tenant_id: tenantId,
    subdomain,
    conf_key:  CONF_KEY,
    timestamp: new Date().toISOString(),
  })
  await redis.hset(CONF_KEY, tenantConfKey(subdomain), conf)
  await redis.publish(RELOAD_CHANNEL, subdomain).catch(() => {})
  logger.info({ subdomain, tenantId }, 'NGINX tenant conf written to Redis')
}

export async function deleteTenantNginxConfig({ subdomain }) {
  if (!subdomain) return
  await redis.hdel(CONF_KEY, tenantConfKey(subdomain))
  await redis.publish(RELOAD_CHANNEL, subdomain).catch(() => {})
  logger.info({ subdomain }, 'NGINX tenant conf removed from Redis')
}
