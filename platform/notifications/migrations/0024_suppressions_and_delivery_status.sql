-- Bounce/complaint suppression list + delivery-status tracking on send_log.
--
-- Two concerns, one migration (both feed off provider webhooks):
--
--   suppressions — recipients (email address or phone number) that must not be
--   contacted again. Populated by the Resend webhook (email.bounced /
--   email.complained) and, on the SMS side, by Twilio opt-outs surfaced via the
--   StatusCallback. A hard bounce or a complaint means future sends to that
--   address damage domain reputation; the email sender consults this table and
--   skips suppressed recipients (logged in send_log with status='skipped').
--
--   send_log.provider_message_id + send_log.delivery_status — let the provider
--   webhooks correlate an async delivery result back to the original attempt.
--   The send is logged immediately as 'sent' (accepted by the provider); the
--   webhook later flips delivery_status to 'delivered'/'bounced'/'complained'
--   (email) or 'delivered'/'failed'/'undelivered' (SMS).

-- ── Suppression list ──────────────────────────────────────────────────────
-- Not RLS-scoped: the provider webhooks are unauthenticated (signed, not
-- JWT-bearing) and carry no app/tenant context, and a suppressed address is a
-- deliverability fact about the address itself, independent of tenant. The
-- email sender's lookup is therefore a plain SELECT by (channel, recipient).
CREATE TABLE IF NOT EXISTS platform_notifications.suppressions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  -- Normalised recipient: lower-cased email or E.164 phone.
  recipient   TEXT NOT NULL,
  -- Why the address is suppressed: 'bounce' | 'complaint' | 'opt_out' | 'manual'.
  reason      TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint', 'opt_out', 'manual')),
  -- Free-form detail from the provider (bounce subtype, etc.). Truncated by caller.
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, recipient)
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_suppressions_recipient
  ON platform_notifications.suppressions (channel, recipient);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.suppressions
  TO svc_platform_notifications;

-- ── Delivery-status tracking on send_log ──────────────────────────────────
ALTER TABLE platform_notifications.send_log
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status     TEXT;

-- Webhooks look up the original attempt by the provider's message id.
CREATE INDEX IF NOT EXISTS idx_platform_notif_send_log_provider_msg
  ON platform_notifications.send_log (provider_message_id);

-- Retention purge (recommendation #16) scans by sent_at; index keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_platform_notif_send_log_sent_at
  ON platform_notifications.send_log (sent_at);
