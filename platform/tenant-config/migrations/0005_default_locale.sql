-- Per-tenant default locale used by platform-scheduler reminder jobs to
-- localize notifications when neither the booking/reservation nor the user
-- carries an explicit locale. Free text (no enum) so adding a new locale is a
-- pure data change. The notifications module's renderTemplate falls back to
-- 'es' if the requested locale has no template row, so an unsupported value
-- here only degrades to Spanish — never blocks delivery.
ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS default_locale TEXT NOT NULL DEFAULT 'es';
