-- Push notifications via FCM HTTP v1 (Android, iOS via APNs auth key, web).
-- Each row is a single registered device token belonging to a single user.
-- The token is the unique identifier (FCM rotates tokens occasionally; we
-- accept the latest by upserting on token).
CREATE TABLE IF NOT EXISTS platform_notifications.push_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT NOT NULL,
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token         TEXT NOT NULL UNIQUE,
  label         TEXT,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_push_user
  ON platform_notifications.push_devices (user_id);

ALTER TABLE platform_notifications.push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_notifications.push_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_notif_push_isolation ON platform_notifications.push_devices
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.push_devices
  TO svc_platform_notifications;

-- Extend module config CHECK with FCM keys (and reserved APNs slots so
-- runtime can grow into native APNs without a future schema change).
ALTER TABLE platform_notifications.config
  DROP CONSTRAINT IF EXISTS config_key_check;

ALTER TABLE platform_notifications.config
  ADD CONSTRAINT config_key_check
  CHECK (key IN (
    'sendgrid_api_key', 'sender_email', 'sender_name',
    'twilio_account_sid', 'twilio_api_key_sid', 'twilio_api_key_secret',
    'twilio_messaging_service_sid', 'twilio_default_sender',
    'rate_limit_per_user_per_hour', 'rate_limit_per_user_per_day',
    'digest_mode',
    'fcm_project_id', 'fcm_service_account_json',
    'apns_team_id', 'apns_key_id', 'apns_bundle_id', 'apns_p8_key', 'apns_environment'
  ));
