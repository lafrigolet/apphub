CREATE TABLE IF NOT EXISTS platform_tenants.apps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id       TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  subdomain    TEXT UNIQUE NOT NULL,
  jwt_audience TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_tenants.tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id       TEXT NOT NULL REFERENCES platform_tenants.apps(app_id),
  display_name TEXT NOT NULL,
  subdomain    TEXT UNIQUE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_tenants_app ON platform_tenants.tenants (app_id);

-- No app rows are pre-seeded. After bootstrap.sh runs, only the 'platform'
-- app (subdomain 'voragine-console') exists. Real apps are registered later
-- via voragine-console > Apps > Nueva app.
