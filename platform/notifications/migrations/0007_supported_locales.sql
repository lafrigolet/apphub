-- Authoritative list of locales the platform supports for notification
-- templates. The frontend uses this to populate the "+ Locale" / Locale
-- filter dropdowns so a tenant can't accidentally type 'fr' when no template
-- has been seeded for it. Adding a row here is the canonical way to declare
-- a new supported locale; the rendering layer doesn't read this table — it
-- just falls back to 'es' when a row is missing.
CREATE TABLE IF NOT EXISTS platform_notifications.supported_locales (
  locale     TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.supported_locales
  TO svc_platform_notifications;

INSERT INTO platform_notifications.supported_locales (locale, label) VALUES
  ('es', 'Español'),
  ('en', 'English')
ON CONFLICT (locale) DO NOTHING;
