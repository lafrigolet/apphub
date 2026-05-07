-- Fase 2 of tenant-console: every tenant-facing app exposes the baseline
-- modules — tenants (Overview/Settings/Danger), auth (Admins), audit (log),
-- notifications (email domains). splitpay only goes in when the app already
-- has it enabled. The previous migration (0006) seeded enabled_modules with
-- domain-specific entries; this migration adds the cross-cutting baseline
-- without touching what's already there.
--
-- Idempotent: array_cat + ARRAY(SELECT DISTINCT …) keeps each module listed
-- exactly once even after repeat runs.

UPDATE platform_tenants.apps
   SET enabled_modules = ARRAY(
         SELECT DISTINCT unnest(enabled_modules || ARRAY['tenants','auth','audit','notifications'])
       )
 WHERE app_id <> 'voragine-console';   -- staff console manages itself differently

-- Add splitpay to enabled_modules for apps that already have it enabled.
UPDATE platform_tenants.apps
   SET enabled_modules = ARRAY(
         SELECT DISTINCT unnest(enabled_modules || ARRAY['splitpay'])
       )
 WHERE splitpay_enabled = TRUE
   AND NOT ('splitpay' = ANY(enabled_modules));
