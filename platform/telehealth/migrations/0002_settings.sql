-- Microservice-level settings for the video provider used to provision
-- telehealth rooms (Daily.co, Twilio Video, Whereby, or Jitsi-as-a-Service).
-- A single active_provider is selected at a time; provisionRoomStub is replaced
-- by a call to that provider's API. Per-tenant settings (room policy, recording
-- consent text) are out of scope here.
CREATE TABLE IF NOT EXISTS platform_telehealth.settings (
  key             TEXT PRIMARY KEY CHECK (key IN (
    'active_provider',
    'daily_api_key',
    'daily_domain',
    'twilio_account_sid',
    'twilio_api_key_sid',
    'twilio_api_key_secret',
    'whereby_api_key',
    'whereby_subdomain',
    'jitsi_app_id',
    'jitsi_api_key_id',
    'jitsi_private_key'
  )),
  encrypted_value BYTEA,
  plain_value     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_telehealth.settings
  TO svc_platform_telehealth;
