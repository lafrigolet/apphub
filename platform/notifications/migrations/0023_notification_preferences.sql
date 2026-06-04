-- User notification preferences + opt-out (GDPR / CAN-SPAM).
--
-- Two tables:
--
--   notification_preferences — one row per (user, category, channel) that the
--   user has explicitly muted. Absence of a row means "send" (opt-out model:
--   transactional notifications default ON; the user actively silences what
--   they don't want). `category` is a coarse grouping derived from the event
--   type (e.g. 'bookings', 'orders', 'marketing'); `channel` is the delivery
--   channel ('email'|'sms'|'push') or '*' to mute the whole category across
--   channels.
--
--   unsubscribe_tokens — one opaque token per (user) used to power the
--   one-click List-Unsubscribe link in email footers. The token is stable so
--   it can live in a template footer; resolving it lets an unauthenticated
--   click mute the relevant category without a login.

CREATE TABLE IF NOT EXISTS platform_notifications.notification_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      TEXT NOT NULL,
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  category    TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT '*'
              CHECK (channel IN ('email', 'sms', 'push', '*')),
  muted       BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, user_id, category, channel)
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_prefs_user
  ON platform_notifications.notification_preferences (user_id);

ALTER TABLE platform_notifications.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_notifications.notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_notif_prefs_isolation
  ON platform_notifications.notification_preferences
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.notification_preferences
  TO svc_platform_notifications;

-- One-click unsubscribe tokens. Not tenant-scoped via RLS on read because the
-- public unsubscribe endpoint resolves a token without a JWT (no app/tenant
-- context); the row itself carries the scope it should apply to. The token is
-- random and unguessable, so leaking it only allows muting that one user.
CREATE TABLE IF NOT EXISTS platform_notifications.unsubscribe_tokens (
  token       TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL,
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_unsub_user
  ON platform_notifications.unsubscribe_tokens (user_id);

-- No RLS on unsubscribe_tokens: the public endpoint must read it without a
-- tenant context. The token is the only credential. The grant is read+write so
-- the authenticated preferences endpoint can mint a token on demand.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.unsubscribe_tokens
  TO svc_platform_notifications;
