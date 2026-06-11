-- Dev seed for the TPV app (Tap to Pay). Idempotent, dev-only.
--
-- Run (from repo root, stack up):
--   docker compose exec -T postgres psql -U splitpay -d splitpay -f - < apps/tpv/seed.sql
--
-- Creates:
--   - app    : tpv                         (subdomain tpv)
--   - tenant : TPV de Prueba               (id 60000000-…-0001)
--   - user   : cajero@tpv.local / tpv1234  (rol user — login silencioso de la app Expo)
--
-- The password_hash below is bcrypt(cost 12) of 'tpv1234' (dev password,
-- committed on purpose — only valid in dev). Regenerate with:
--   docker compose exec -T platform-core node -e \
--     "require('bcrypt').hash('<pwd>',12).then(h=>console.log(h))"

BEGIN;

-- 1. App
INSERT INTO platform_tenants.apps
  (app_id, display_name, subdomain, jwt_audience, enabled_modules)
VALUES
  ('tpv', 'TPV / Caja', 'tpv', 'tpv', ARRAY['tenants','auth','notifications','payments','tpv'])
ON CONFLICT (app_id) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  subdomain       = EXCLUDED.subdomain,
  enabled_modules = EXCLUDED.enabled_modules;

-- 2. Tenant de prueba (UUID fijo — la app Expo lo lleva en su config)
INSERT INTO platform_tenants.tenants
  (id, app_id, display_name, subdomain, status, country, plan, contact_email, default_locale)
VALUES
  ('60000000-0000-0000-0000-000000000001', 'tpv', 'TPV de Prueba', 'tpv-demo',
   'active', 'ES', 'STARTER', 'cajero@tpv.local', 'es')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  subdomain    = EXCLUDED.subdomain,
  status       = EXCLUDED.status;

-- 3. Usuario cajero (login silencioso). Hash bcrypt de 'tpv1234'.
INSERT INTO platform_auth.users
  (id, app_id, tenant_id, email, password_hash, role, display_name)
VALUES
  ('60000001-0000-0000-0000-000000000001', 'tpv',
   '60000000-0000-0000-0000-000000000001', 'cajero@tpv.local',
   '$2b$12$wo8cbEsmQbIBH8M37Am/8ulgLh8SnQZnbxQQvsKWYpFRBIfbkmsge',
   'user', 'Cajero TPV')
ON CONFLICT (id) DO UPDATE SET
  email         = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  display_name  = EXCLUDED.display_name,
  revoked_at    = NULL;

-- 4. Settings fiscales del tenant TPV (necesarios para emitir recibo, fase 2):
--    emisor + auto-emisión del ticket simplificado al cobrar.
INSERT INTO platform_tpv.settings
  (app_id, tenant_id, sub_tenant_id, issuer_nif, issuer_name, issuer_city,
   issuer_country, auto_issue_simplified, default_sale_tax_rate)
VALUES
  ('tpv', '60000000-0000-0000-0000-000000000001', NULL,
   'B12345678', 'TPV de Prueba SL', 'Sevilla', 'ES', TRUE, 21.00)
ON CONFLICT (app_id, tenant_id, sub_tenant_id) DO UPDATE SET
  issuer_nif            = EXCLUDED.issuer_nif,
  issuer_name           = EXCLUDED.issuer_name,
  auto_issue_simplified = EXCLUDED.auto_issue_simplified,
  default_sale_tax_rate = EXCLUDED.default_sale_tax_rate;

-- 5. Serie de numeración 'A' (simplificadas) para el tenant.
INSERT INTO platform_tpv.number_series
  (app_id, tenant_id, sub_tenant_id, code, kind, prefix)
VALUES
  ('tpv', '60000000-0000-0000-0000-000000000001', NULL, 'A', 'simplified', '')
ON CONFLICT (app_id, tenant_id, sub_tenant_id, code) DO NOTHING;

COMMIT;
