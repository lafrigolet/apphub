-- Module config: SendGrid API key (encrypted) + sender identity.
-- Replaces (with env-var fallback) the SENDGRID_API_KEY / SENDGRID_FROM_EMAIL
-- env vars so staff can change credentials at runtime via voragine-console.
CREATE TABLE IF NOT EXISTS platform_notifications.config (
  key             TEXT PRIMARY KEY CHECK (key IN ('sendgrid_api_key', 'sender_email', 'sender_name')),
  encrypted_value BYTEA,
  plain_value     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email templates keyed by event name (e.g. 'booking.reminder.due'). The
-- email service looks up a template here at send time, falling back to a
-- hardcoded default if no row exists or the row is disabled.
CREATE TABLE IF NOT EXISTS platform_notifications.templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  channel     TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'push')),
  subject     TEXT,
  body_text   TEXT NOT NULL,
  body_html   TEXT,
  variables   TEXT[] NOT NULL DEFAULT '{}',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.config, platform_notifications.templates
  TO svc_platform_notifications;

-- Seed the 6 templates the email service already uses today, with the same
-- subject/body text. Voragine-console can edit these to customize copy
-- without redeploying. Keys must match the lookup keys in email.service.js.
INSERT INTO platform_notifications.templates (key, channel, subject, body_text, variables) VALUES
  ('user.welcome',                  'email',
   'Bienvenido a {{appId}}',
   'Hola,' || E'\n\n' || 'Tu cuenta en {{appId}} ha sido creada correctamente. ¡Bienvenido!' || E'\n\n' || 'El equipo de AIKIKAN',
   ARRAY['appId']
  ),
  ('auth.password_reset',           'email',
   'Restablecer contraseña — AIKIKAN',
   'Haz clic en el siguiente enlace para restablecer tu contraseña (válido 1 hora):' || E'\n\n' || '{{resetUrl}}' || E'\n\n' || 'Si no solicitaste este cambio, ignora este mensaje.',
   ARRAY['resetUrl']
  ),
  ('booking.reminder.due',          'email',
   'Recordatorio: tu cita es {{lead}}',
   'Hola{{namePrefix}},' || E'\n\n' || 'Te recordamos que tienes una cita {{lead}} ({{when}}).' || E'\n\n' || 'Si no puedes asistir, por favor cancela con antelación.',
   ARRAY['namePrefix', 'lead', 'when']
  ),
  ('reservation.reminder.due',      'email',
   'Recordatorio: tu reserva es {{lead}}',
   'Hola{{namePrefix}},' || E'\n\n' || 'Te recordamos tu reserva {{lead}} ({{when}}) para {{partySize}} personas.' || E'\n\n' || 'Si no puedes asistir, te agradeceríamos que canceles con antelación.',
   ARRAY['namePrefix', 'lead', 'when', 'partySize']
  ),
  ('package.expiring',              'email',
   'Tu bono caduca {{lead}}',
   'Hola,' || E'\n\n' || 'Tu bono caduca el {{expires}} ({{lead}}). Te quedan {{remainingSessions}} sesión(es) por usar.' || E'\n\n' || 'Reserva ahora para no perderlas.',
   ARRAY['expires', 'lead', 'remainingSessions']
  ),
  ('dispute.sla_breached.staff',    'email',
   '[STAFF] Disputa sin respuesta del vendedor (>48h)',
   'Disputa {{disputeId}} sobre el pedido {{orderId}} (abierta {{openedAt}}) lleva más de 48 h sin respuesta del vendedor. Revisar y escalar.',
   ARRAY['disputeId', 'orderId', 'openedAt']
  )
ON CONFLICT (key) DO NOTHING;
