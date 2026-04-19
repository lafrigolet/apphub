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

-- Seed known apps
INSERT INTO platform_tenants.apps (app_id, display_name, subdomain, jwt_audience)
VALUES
  ('yoga-studio', 'Yoga Studio', 'yoga',     'yoga-studio'),
  ('split-pay',   'Split Pay',   'splitpay',  'split-pay')
ON CONFLICT (app_id) DO NOTHING;
