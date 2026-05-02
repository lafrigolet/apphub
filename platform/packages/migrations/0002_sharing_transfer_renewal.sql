-- packages upgrades:
--   1. Family sharing — extra users authorised to redeem sessions from a
--      package they don't own. Held in a side table so the same package can
--      be shared with N people at once.
--   2. Transfer / gifting — the act of changing client_user_id on the
--      purchased_packages row, captured in transfers as an audit trail.
--   3. Renewal automático — package_templates.auto_renew + a per-purchase
--      auto_renew flag and renewed_from to thread renewal chains.

-- 1. Authorised users (family / household sharing) ----------------------
CREATE TABLE IF NOT EXISTS platform_packages.package_authorized_users (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  package_id      UUID         NOT NULL REFERENCES platform_packages.purchased_packages(id) ON DELETE CASCADE,
  user_id         UUID         NOT NULL,
  display_name    TEXT,
  added_by        UUID,                                                 -- the owner who shared
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (package_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_packages_authorized_user
  ON platform_packages.package_authorized_users (app_id, tenant_id, user_id);

ALTER TABLE platform_packages.package_authorized_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_packages.package_authorized_users FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_packages_auth_users_isolation
  ON platform_packages.package_authorized_users
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, DELETE
  ON platform_packages.package_authorized_users
  TO svc_platform_packages;

-- 2. Transfer / gifting log ---------------------------------------------
CREATE TABLE IF NOT EXISTS platform_packages.package_transfers (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  package_id      UUID         NOT NULL REFERENCES platform_packages.purchased_packages(id) ON DELETE CASCADE,
  from_user_id    UUID         NOT NULL,
  to_user_id      UUID         NOT NULL,
  kind            TEXT         NOT NULL CHECK (kind IN ('transfer', 'gift')),
  message         TEXT,
  actor_user_id   UUID,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_packages_transfers_package
  ON platform_packages.package_transfers (package_id, created_at DESC);

ALTER TABLE platform_packages.package_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_packages.package_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_packages_transfers_isolation
  ON platform_packages.package_transfers
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT
  ON platform_packages.package_transfers
  TO svc_platform_packages;

-- 3. Auto-renewal flags -------------------------------------------------
ALTER TABLE platform_packages.package_templates
  ADD COLUMN IF NOT EXISTS auto_renew_default BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE platform_packages.purchased_packages
  ADD COLUMN IF NOT EXISTS auto_renew     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS renewed_from   UUID    REFERENCES platform_packages.purchased_packages(id),
  ADD COLUMN IF NOT EXISTS renewed_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_packages_renew_pending
  ON platform_packages.purchased_packages (app_id, tenant_id, auto_renew, expires_at)
  WHERE auto_renew = TRUE;
