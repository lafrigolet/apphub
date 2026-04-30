-- Availability module: atomic holds for slots while a client is checking out.
-- Slot computation reads from platform_resources.* and platform_bookings.* via cross-schema queries
-- (see src/repositories/availability.repository.js — issued by the same superuser-migrated DB but
-- the runtime role only needs SELECT on those schemas).

CREATE TABLE IF NOT EXISTS platform_availability.holds (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id         TEXT         NOT NULL,
  tenant_id      UUID         NOT NULL,
  service_id     UUID         NOT NULL,
  resource_id    UUID         NOT NULL,
  starts_at      TIMESTAMPTZ  NOT NULL,
  ends_at        TIMESTAMPTZ  NOT NULL,
  client_user_id UUID,
  expires_at     TIMESTAMPTZ  NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index used by overlap checks and TTL cleanup.
CREATE INDEX IF NOT EXISTS idx_platform_availability_holds_resource_when
  ON platform_availability.holds (resource_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_platform_availability_holds_expires
  ON platform_availability.holds (expires_at);

ALTER TABLE platform_availability.holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_availability.holds FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_availability_holds_isolation ON platform_availability.holds
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Grant the availability runtime role read access to the schemas it queries.
-- (Tables in resources/bookings already have RLS scoped by app_id+tenant_id.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_availability') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_services  TO svc_platform_availability';
    EXECUTE 'GRANT USAGE ON SCHEMA platform_resources TO svc_platform_availability';
    EXECUTE 'GRANT USAGE ON SCHEMA platform_bookings  TO svc_platform_availability';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_services  TO svc_platform_availability';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_resources TO svc_platform_availability';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_bookings  TO svc_platform_availability';
  END IF;
END
$$;
