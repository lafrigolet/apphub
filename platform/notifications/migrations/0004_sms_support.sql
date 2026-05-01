-- SMS support: Twilio config keys + templates UNIQUE on (key, channel) so the
-- same event key can have one row per channel.
--
-- 1. Extend the config CHECK to accept the four Twilio keys.
-- 2. Drop the templates UNIQUE(key) and replace with UNIQUE(key, channel).
-- 3. Seed the SMS variant of booking.reminder.due so the wiring works
--    end-to-end out of the box (other event keys can be added later).

-- ── 1. Config CHECK ────────────────────────────────────────────────────
ALTER TABLE platform_notifications.config
  DROP CONSTRAINT IF EXISTS config_key_check;

ALTER TABLE platform_notifications.config
  ADD CONSTRAINT config_key_check
  CHECK (key IN (
    'sendgrid_api_key', 'sender_email', 'sender_name',
    'twilio_account_sid', 'twilio_api_key_sid', 'twilio_api_key_secret',
    'twilio_messaging_service_sid', 'twilio_default_sender'
  ));

-- ── 2. Templates UNIQUE on (key, channel) ──────────────────────────────
ALTER TABLE platform_notifications.templates
  DROP CONSTRAINT IF EXISTS templates_key_key;

ALTER TABLE platform_notifications.templates
  ADD CONSTRAINT templates_key_channel_key UNIQUE (key, channel);

-- ── 3. Seed the SMS variant of the booking reminder ────────────────────
-- Body is plain text, kept short. Body_html stays NULL because SMS doesn't
-- have one. ON CONFLICT no-ops if the row already exists.
INSERT INTO platform_notifications.templates (key, channel, subject, body_text, variables) VALUES
  ('booking.reminder.due', 'sms',
   NULL,
   'Recordatorio: tu cita es {{lead}} ({{when}}). Si no puedes asistir, cancela con antelación.',
   ARRAY['lead', 'when']
  )
ON CONFLICT (key, channel) DO NOTHING;
