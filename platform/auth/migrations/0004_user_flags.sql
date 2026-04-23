ALTER TABLE platform_auth.users
  ADD COLUMN IF NOT EXISTS display_name   TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at     TIMESTAMPTZ;

-- Staff (platform) callers can read across tenants when they set
-- SELECT set_config('app.staff_access', 'true', true) inside their transaction.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'platform_auth'
      AND tablename  = 'users'
      AND policyname = 'platform_auth_users_staff_access'
  ) THEN
    CREATE POLICY platform_auth_users_staff_access ON platform_auth.users
      USING (current_setting('app.staff_access', true) = 'true');
  END IF;
END
$$;
