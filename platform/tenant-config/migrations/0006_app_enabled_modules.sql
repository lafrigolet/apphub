-- enabled_modules drives which manifests the tenant-console-portal mounts at
-- runtime (Fase 0 of the tenant-console roadmap in TODO.md).
--
-- Each entry must match a `platform/<modulo>` capability id; the frontend
-- imports its manifest dynamically and only mounts the module if its id is
-- listed here. An empty array means the app has no tenant-facing features
-- (e.g. voragine-console, which is the staff console itself).
ALTER TABLE platform_tenants.apps
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] NOT NULL DEFAULT '{}';

-- Best-effort seed for the apps that exist today. Idempotent — only updates
-- rows we know about; new apps default to empty until staff sets them.
UPDATE platform_tenants.apps
   SET enabled_modules = ARRAY[
         'services', 'resources', 'bookings', 'availability',
         'packages', 'practitioner-payouts',
         'notifications', 'intake-forms', 'telehealth'
       ]
 WHERE app_id = 'yoga-studio' AND enabled_modules = '{}';

UPDATE platform_tenants.apps
   SET enabled_modules = ARRAY[
         'services', 'resources', 'bookings', 'availability',
         'packages', 'practitioner-payouts',
         'notifications'
       ]
 WHERE app_id = 'aikikan' AND enabled_modules = '{}';

UPDATE platform_tenants.apps
   SET enabled_modules = ARRAY[
         'orders', 'splitpay', 'disputes', 'notifications'
       ]
 WHERE app_id = 'split-pay' AND enabled_modules = '{}';

-- voragine-console (the staff console itself) gets no tenant-console
-- manifests; staff lives in a different app.
UPDATE platform_tenants.apps
   SET enabled_modules = ARRAY[]::TEXT[]
 WHERE app_id = 'voragine-console' AND enabled_modules = '{}';
