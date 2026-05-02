-- i18n: each (key, channel) can now have multiple rows, one per locale.
-- The renderer asks for a specific locale and falls back to 'es' (the platform
-- default) when missing. New locales can be added at runtime via the templates
-- editor without code changes.

ALTER TABLE platform_notifications.templates
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'es';

ALTER TABLE platform_notifications.templates
  DROP CONSTRAINT IF EXISTS templates_key_channel_key;

ALTER TABLE platform_notifications.templates
  ADD CONSTRAINT templates_key_channel_locale_key UNIQUE (key, channel, locale);

CREATE INDEX IF NOT EXISTS idx_platform_notif_templates_lookup
  ON platform_notifications.templates (key, channel, locale)
  WHERE enabled;

-- ── English seed for the existing keys ───────────────────────────────────
-- Same variable names as the Spanish versions; renderTemplate() picks one or
-- the other by locale at send time.
INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, variables) VALUES
  ('user.welcome', 'email', 'en',
   'Welcome to {{appId}}',
   'Hi,' || E'\n\n' || 'Your {{appId}} account has been created. Welcome!' || E'\n\n' || 'The AIKIKAN team',
   ARRAY['appId']
  ),
  ('auth.password_reset', 'email', 'en',
   'Reset your password — AIKIKAN',
   'Click the link below to reset your password (valid for 1 hour):' || E'\n\n' || '{{resetUrl}}' || E'\n\n' || 'If you did not request this change, please ignore this message.',
   ARRAY['resetUrl']
  ),
  ('booking.reminder.due', 'email', 'en',
   'Reminder: your appointment is {{lead}}',
   'Hi{{namePrefix}},' || E'\n\n' || 'A friendly reminder that your appointment is {{lead}} ({{when}}).' || E'\n\n' || 'If you cannot make it, please cancel in advance.',
   ARRAY['namePrefix', 'lead', 'when']
  ),
  ('reservation.reminder.due', 'email', 'en',
   'Reminder: your reservation is {{lead}}',
   'Hi{{namePrefix}},' || E'\n\n' || 'A friendly reminder of your reservation {{lead}} ({{when}}) for {{partySize}} guests.' || E'\n\n' || 'If you cannot make it, we appreciate a cancellation in advance.',
   ARRAY['namePrefix', 'lead', 'when', 'partySize']
  ),
  ('package.expiring', 'email', 'en',
   'Your package expires {{lead}}',
   'Hi,' || E'\n\n' || 'Your package expires on {{expires}} ({{lead}}). You have {{remainingSessions}} session(s) left.' || E'\n\n' || 'Book now so you do not lose them.',
   ARRAY['expires', 'lead', 'remainingSessions']
  ),
  ('dispute.sla_breached.staff', 'email', 'en',
   '[STAFF] Dispute without vendor reply (>48h)',
   'Dispute {{disputeId}} on order {{orderId}} (opened {{openedAt}}) has no vendor reply for over 48 h. Review and escalate.',
   ARRAY['disputeId', 'orderId', 'openedAt']
  ),
  ('booking.reminder.due', 'sms', 'en',
   NULL,
   'Reminder: your appointment is {{lead}} ({{when}}). If you cannot make it, please cancel in advance.',
   ARRAY['lead', 'when']
  ),
  ('reservation.reminder.due', 'sms', 'en',
   NULL,
   'Reminder: your reservation is {{lead}} ({{when}}) for {{partySize}} guests. If you cannot make it, please cancel in advance.',
   ARRAY['lead', 'when', 'partySize']
  )
ON CONFLICT (key, channel, locale) DO NOTHING;
