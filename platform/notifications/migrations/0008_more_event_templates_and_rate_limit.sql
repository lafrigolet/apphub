-- Two changes bundled (same area, same review):
--   1. Seed default templates (es + en, email + sms) for the additional event
--      types the consumer now subscribes to: booking.confirmed/cancelled/
--      rescheduled, reservation.created/cancelled, package.exhausted,
--      payout.paid.
--   2. Add per-user rate-limit keys to the module config so a runaway producer
--      can't flood a single recipient. Limits are integers (max sends per
--      window per user). Empty / 0 means unlimited.

-- ── 1. Config CHECK (extend) ─────────────────────────────────────────────
ALTER TABLE platform_notifications.config
  DROP CONSTRAINT IF EXISTS config_key_check;

ALTER TABLE platform_notifications.config
  ADD CONSTRAINT config_key_check
  CHECK (key IN (
    'sendgrid_api_key', 'sender_email', 'sender_name',
    'twilio_account_sid', 'twilio_api_key_sid', 'twilio_api_key_secret',
    'twilio_messaging_service_sid', 'twilio_default_sender',
    'rate_limit_per_user_per_hour', 'rate_limit_per_user_per_day'
  ));

-- ── 2. Seed templates ────────────────────────────────────────────────────
-- ES first, then EN. The renderer falls back to 'es' when a locale row is
-- missing, so omitting an EN variant just means English recipients see the
-- Spanish copy until staff edits it.

-- booking.confirmed
INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, variables) VALUES
  ('booking.confirmed', 'email', 'es',
   'Tu cita está confirmada — {{when}}',
   'Hola{{namePrefix}},' || E'\n\n' || 'Tu cita ha sido confirmada para el {{when}}.' || E'\n\n' || 'Si necesitas cancelar o cambiarla, hazlo con antelación.',
   ARRAY['namePrefix', 'when']),
  ('booking.confirmed', 'email', 'en',
   'Your appointment is confirmed — {{when}}',
   'Hi{{namePrefix}},' || E'\n\n' || 'Your appointment has been confirmed for {{when}}.' || E'\n\n' || 'If you need to cancel or reschedule, please do it in advance.',
   ARRAY['namePrefix', 'when']),
  ('booking.confirmed', 'sms', 'es',
   NULL, 'Tu cita ha sido confirmada para el {{when}}.', ARRAY['when']),
  ('booking.confirmed', 'sms', 'en',
   NULL, 'Your appointment is confirmed for {{when}}.', ARRAY['when']),

-- booking.cancelled
  ('booking.cancelled', 'email', 'es',
   'Tu cita ha sido cancelada',
   'Hola{{namePrefix}},' || E'\n\n' || 'Tu cita del {{when}} ha sido cancelada.{{reasonLine}}' || E'\n\n' || 'Si quieres reservar otro hueco, te esperamos.',
   ARRAY['namePrefix', 'when', 'reasonLine']),
  ('booking.cancelled', 'email', 'en',
   'Your appointment has been cancelled',
   'Hi{{namePrefix}},' || E'\n\n' || 'Your appointment on {{when}} has been cancelled.{{reasonLine}}' || E'\n\n' || 'You can book another slot whenever you want.',
   ARRAY['namePrefix', 'when', 'reasonLine']),
  ('booking.cancelled', 'sms', 'es',
   NULL, 'Tu cita del {{when}} ha sido cancelada.', ARRAY['when']),
  ('booking.cancelled', 'sms', 'en',
   NULL, 'Your appointment on {{when}} has been cancelled.', ARRAY['when']),

-- booking.rescheduled
  ('booking.rescheduled', 'email', 'es',
   'Tu cita ha sido reprogramada — {{when}}',
   'Hola{{namePrefix}},' || E'\n\n' || 'Tu cita ha sido reprogramada para el {{when}}.' || E'\n\n' || 'Si la nueva fecha no te encaja, escríbenos.',
   ARRAY['namePrefix', 'when']),
  ('booking.rescheduled', 'email', 'en',
   'Your appointment has been rescheduled — {{when}}',
   'Hi{{namePrefix}},' || E'\n\n' || 'Your appointment has been rescheduled to {{when}}.' || E'\n\n' || 'If this new time does not work, please reply to this email.',
   ARRAY['namePrefix', 'when']),
  ('booking.rescheduled', 'sms', 'es',
   NULL, 'Tu cita ha sido reprogramada para el {{when}}.', ARRAY['when']),
  ('booking.rescheduled', 'sms', 'en',
   NULL, 'Your appointment has been rescheduled to {{when}}.', ARRAY['when']),

-- reservation.created
  ('reservation.created', 'email', 'es',
   'Reserva recibida — {{when}} para {{partySize}}',
   'Hola{{namePrefix}},' || E'\n\n' || 'Hemos recibido tu reserva para el {{when}} ({{partySize}} personas). Te avisaremos en cuanto la confirmemos.',
   ARRAY['namePrefix', 'when', 'partySize']),
  ('reservation.created', 'email', 'en',
   'Reservation received — {{when}} for {{partySize}}',
   'Hi{{namePrefix}},' || E'\n\n' || 'We have received your reservation for {{when}} ({{partySize}} guests). We will confirm it shortly.',
   ARRAY['namePrefix', 'when', 'partySize']),

-- reservation.cancelled
  ('reservation.cancelled', 'email', 'es',
   'Tu reserva ha sido cancelada',
   'Hola{{namePrefix}},' || E'\n\n' || 'Tu reserva del {{when}} ha sido cancelada.',
   ARRAY['namePrefix', 'when']),
  ('reservation.cancelled', 'email', 'en',
   'Your reservation has been cancelled',
   'Hi{{namePrefix}},' || E'\n\n' || 'Your reservation on {{when}} has been cancelled.',
   ARRAY['namePrefix', 'when']),
  ('reservation.cancelled', 'sms', 'es',
   NULL, 'Tu reserva del {{when}} ha sido cancelada.', ARRAY['when']),
  ('reservation.cancelled', 'sms', 'en',
   NULL, 'Your reservation on {{when}} has been cancelled.', ARRAY['when']),

-- package.exhausted
  ('package.exhausted', 'email', 'es',
   'Has agotado las sesiones de tu bono',
   'Hola,' || E'\n\n' || 'Has utilizado la última sesión de tu bono. ¡Esperamos verte pronto de nuevo!',
   ARRAY[]::TEXT[]),
  ('package.exhausted', 'email', 'en',
   'Your package is fully used',
   'Hi,' || E'\n\n' || 'You have used the last session of your package. We hope to see you again soon.',
   ARRAY[]::TEXT[]),

-- payout.paid (notifies the practitioner)
  ('payout.paid', 'email', 'es',
   'Tu liquidación de {{amount}} se ha pagado',
   'Hola,' || E'\n\n' || 'Tu liquidación correspondiente al periodo {{periodLabel}} ha sido pagada por importe de {{amount}}. Referencia: {{externalRef}}.',
   ARRAY['amount', 'periodLabel', 'externalRef']),
  ('payout.paid', 'email', 'en',
   'Your {{amount}} payout has been paid',
   'Hi,' || E'\n\n' || 'Your payout for period {{periodLabel}} has been paid: {{amount}}. Reference: {{externalRef}}.',
   ARRAY['amount', 'periodLabel', 'externalRef'])
ON CONFLICT (key, channel, locale) DO NOTHING;

-- ── 3. Add the new locales to the supported list (idempotent) ────────────
-- (Already inserted in 0007; this is a no-op if 0007 already ran.)
INSERT INTO platform_notifications.supported_locales (locale, label) VALUES
  ('es', 'Español'),
  ('en', 'English')
ON CONFLICT (locale) DO NOTHING;
