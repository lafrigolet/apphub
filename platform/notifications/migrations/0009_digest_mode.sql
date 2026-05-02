-- Digest mode: opt-in to batch non-urgent events into a daily email instead
-- of one email per event. The consumer routes a fixed allowlist of event
-- types through the digest queue when this is on; reminders and time-critical
-- events stay immediate.
ALTER TABLE platform_notifications.config
  DROP CONSTRAINT IF EXISTS config_key_check;

ALTER TABLE platform_notifications.config
  ADD CONSTRAINT config_key_check
  CHECK (key IN (
    'sendgrid_api_key', 'sender_email', 'sender_name',
    'twilio_account_sid', 'twilio_api_key_sid', 'twilio_api_key_secret',
    'twilio_messaging_service_sid', 'twilio_default_sender',
    'rate_limit_per_user_per_hour', 'rate_limit_per_user_per_day',
    'digest_mode'
  ));
