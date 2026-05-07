-- aikikan-server initial schema. RLS by (app_id, tenant_id) following
-- the platform pattern. user_id is FK-logical to platform_auth.users.id;
-- consistency on user revocation is via Redis event `user.revoked` —
-- handled in src/events/user-revoked.handler.js, NOT by SQL FK across
-- schemas (which would violate the boundary rule).

CREATE TABLE IF NOT EXISTS app_aikikan.members (
  user_id        UUID PRIMARY KEY,
  app_id         TEXT NOT NULL,
  tenant_id      UUID NOT NULL,
  sub_tenant_id  UUID,

  member_number  TEXT,
  member_since   DATE,
  aikido_grade   TEXT,         -- e.g. 'KYU_5', 'KYU_4', …, 'DAN_1', 'DAN_2'
  dojo_name      TEXT,
  notes          TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Member numbers are unique within (app, tenant). NULL allowed — not
-- every member has a federation number from day one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_aikikan_members_number
  ON app_aikikan.members (app_id, tenant_id, member_number)
  WHERE member_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_aikikan_members_tenant
  ON app_aikikan.members (app_id, tenant_id);

ALTER TABLE app_aikikan.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.members FORCE ROW LEVEL SECURITY;

CREATE POLICY app_aikikan_members_isolation ON app_aikikan.members
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
