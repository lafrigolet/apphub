-- Rebrand: voragine-console → console (app_id, not just subdomain).
--
-- Migration 0011 only renamed the subdomain. This one renames the
-- denormalized `app_id` column in every platform_* schema that has one.
-- After this runs, all DB rows previously scoped to app_id='voragine-console'
-- (apps, users, refresh tokens, audit log, oauth connections, …) are scoped
-- to app_id='console'.
--
-- The constraint platform_tenants.tenants → apps(app_id) doesn't cascade
-- updates, so we drop it, do all the renames, and re-create it with
-- ON UPDATE CASCADE so future renames don't need this dance.
--
-- IMPORTANT: existing JWTs still carry app_id='voragine-console' until the
-- staff log in again. After this migration the frontend emits new logins
-- with appId='console'; old refresh tokens become unusable since the user
-- row's app_id no longer matches. Communicate the forced re-login.
--
-- The migration is idempotent (no-op once data is fixed) and dynamic — it
-- finds every column named `app_id` across platform_* schemas at runtime,
-- so new modules don't need a per-table UPDATE here.

DO $$
DECLARE
  rec      RECORD;
  cnt      INTEGER;
  fk_exists BOOLEAN;
BEGIN
  -- 1. Drop the cross-schema FK temporarily.
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_app_id_fkey'
  ) INTO fk_exists;

  IF fk_exists THEN
    ALTER TABLE platform_tenants.tenants
      DROP CONSTRAINT tenants_app_id_fkey;
  END IF;

  -- 2. Rename app_id everywhere it appears in platform_* schemas.
  FOR rec IN
    SELECT table_schema, table_name
      FROM information_schema.columns
     WHERE column_name = 'app_id'
       AND table_schema LIKE 'platform_%'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET app_id = ''console'' WHERE app_id = ''voragine-console''',
      rec.table_schema, rec.table_name
    );
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN
      RAISE NOTICE 'voragine-console → console: % rows in %.%',
        cnt, rec.table_schema, rec.table_name;
    END IF;
  END LOOP;

  -- 3. Re-create the FK with ON UPDATE CASCADE so future renames propagate
  --    without needing this drop/recreate dance.
  ALTER TABLE platform_tenants.tenants
    ADD CONSTRAINT tenants_app_id_fkey
    FOREIGN KEY (app_id)
    REFERENCES platform_tenants.apps(app_id)
    ON UPDATE CASCADE;
END $$;
