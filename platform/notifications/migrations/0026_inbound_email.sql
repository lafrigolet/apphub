-- Inbound email (Resend Inbound) — use-cases §23–§29.
--
-- The platform can now *receive* email: MX records point at Resend, Resend
-- fires an `email.received` webhook with metadata only, and the module fetches
-- the full content (GET /emails/receiving/{id}) + attachments on demand, then
-- routes the message to domain modules by publishing events on platform.events.
--
-- Four tables:
--
--   inbound_emails       — one row per received message; the processing FSM is
--                          received → fetched → routed | unrouted | failed | quarantined | archived.
--   inbound_attachments  — attachment metadata; bytes live in the shared S3
--                          bucket (MinIO) under inbound/<emailId>/…, written via
--                          @apphub/platform-sdk/storage (the SDK is a permitted
--                          cross-module channel; platform_storage's schema is not).
--   inbound_routes       — staff-managed address → event rules (exact address or
--                          whole-domain catch-all). Plus-addressing replies are
--                          resolved via inbound_reply_tokens instead.
--   inbound_reply_tokens — opaque tokens minted when an outbound notification
--                          wants replies back in-platform (Reply-To:
--                          reply+<token>@<inbound_domain>); each maps to a target
--                          event + context (e.g. { inquiryId }).
--
-- None of these tables is RLS-scoped: like send_log and suppressions, ingestion
-- happens on an unauthenticated (provider-signed) webhook with no JWT tenant
-- context, and the admin surface is staff/super_admin only. Tenant attribution,
-- when a route or token provides it, is stored as plain columns and travels in
-- the published event payload — consuming modules apply their own scoping.

-- ── inbound_emails ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_notifications.inbound_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL DEFAULT 'resend',
  -- Resend's email id (data.email_id). UNIQUE makes webhook redelivery a no-op.
  provider_email_id   TEXT NOT NULL UNIQUE,
  -- RFC 5322 correlation headers (filled on fetch).
  message_id          TEXT,
  in_reply_to         TEXT,
  from_address        TEXT NOT NULL,
  from_name           TEXT,
  to_addresses        TEXT[] NOT NULL DEFAULT '{}',
  cc_addresses        TEXT[] NOT NULL DEFAULT '{}',
  reply_to            TEXT,
  subject             TEXT,
  body_text           TEXT,
  body_html           TEXT,
  headers             JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Authentication-Results header (SPF/DKIM/DMARC verdict) when present.
  auth_results        TEXT,
  -- Out-of-office / auto-submitted detection — auto-replies never trigger
  -- domain events (mail-loop protection).
  is_auto_reply       BOOLEAN NOT NULL DEFAULT false,
  -- Tenant attribution stamped by the matching route / reply token (nullable:
  -- platform-level mailboxes like leads@ have no tenant).
  app_id              TEXT,
  tenant_id           UUID,
  status              TEXT NOT NULL DEFAULT 'received'
                      CHECK (status IN ('received', 'fetched', 'routed', 'unrouted', 'failed', 'quarantined', 'archived')),
  route_id            UUID,
  routed_event        TEXT,
  -- Dead-letter accounting: attempts incremented per processing try; staff can
  -- reprocess via POST /admin/inbound/:id/reprocess.
  attempts            INT NOT NULL DEFAULT 0,
  error               TEXT,
  quarantine_reason   TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetched_at          TIMESTAMPTZ,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_inbound_status
  ON platform_notifications.inbound_emails (status);
CREATE INDEX IF NOT EXISTS idx_platform_notif_inbound_from
  ON platform_notifications.inbound_emails (from_address);
-- Retention purge scans by received_at.
CREATE INDEX IF NOT EXISTS idx_platform_notif_inbound_received_at
  ON platform_notifications.inbound_emails (received_at);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.inbound_emails
  TO svc_platform_notifications;

-- ── inbound_attachments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_notifications.inbound_attachments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id                UUID NOT NULL REFERENCES platform_notifications.inbound_emails (id) ON DELETE CASCADE,
  provider_attachment_id  TEXT,
  filename                TEXT,
  content_type            TEXT,
  -- cid: for inline images referenced from body_html.
  content_id              TEXT,
  size_bytes              BIGINT,
  -- sha256 of the bytes — dedup: identical content reuses the first object_key.
  sha256                  TEXT,
  bucket                  TEXT,
  object_key              TEXT,
  status                  TEXT NOT NULL DEFAULT 'stored'
                          CHECK (status IN ('stored', 'skipped', 'failed')),
  -- Why a skipped attachment was not stored (type not allowed, too large, …).
  skip_reason             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_inbound_att_email
  ON platform_notifications.inbound_attachments (email_id);
CREATE INDEX IF NOT EXISTS idx_platform_notif_inbound_att_sha
  ON platform_notifications.inbound_attachments (sha256);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.inbound_attachments
  TO svc_platform_notifications;

-- ── inbound_routes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_notifications.inbound_routes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'exact'  → pattern is a full address  (soporte@reply.acme.com)
  -- 'domain' → pattern is a domain        (reply.acme.com) — catch-all
  match_type    TEXT NOT NULL DEFAULT 'exact' CHECK (match_type IN ('exact', 'domain')),
  pattern       TEXT NOT NULL,
  -- Event type published on platform.events when the rule matches
  -- (e.g. 'lead.email.received', 'chat.support.email.received').
  target_event  TEXT NOT NULL,
  -- Optional tenant attribution stamped on the email + event payload.
  app_id        TEXT,
  tenant_id     UUID,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_type, pattern)
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.inbound_routes
  TO svc_platform_notifications;

-- ── inbound_reply_tokens ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_notifications.inbound_reply_tokens (
  token         TEXT PRIMARY KEY,
  target_event  TEXT NOT NULL,
  -- Conversation pointer for the consumer (e.g. { "inquiryId": "…", "party": "user" }).
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,
  app_id        TEXT,
  tenant_id     UUID,
  expires_at    TIMESTAMPTZ,
  used_count    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_reply_tokens_expiry
  ON platform_notifications.inbound_reply_tokens (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.inbound_reply_tokens
  TO svc_platform_notifications;

-- ── Config keys ────────────────────────────────────────────────────────────
-- Recreate config_key_check with the inbound keys. Also fixes a latent gap:
-- `resend_webhook_secret` has been written by the admin config PATCH since the
-- webhook work (0024 era) but was never added to the CHECK, so saving it
-- violated the constraint.
ALTER TABLE platform_notifications.config
  DROP CONSTRAINT IF EXISTS config_key_check;

ALTER TABLE platform_notifications.config
  ADD CONSTRAINT config_key_check CHECK (
    key = ANY (ARRAY[
      'resend_api_key',
      'resend_webhook_secret',
      'sender_email',
      'sender_name',
      'twilio_account_sid',
      'twilio_api_key_sid',
      'twilio_api_key_secret',
      'twilio_messaging_service_sid',
      'twilio_default_sender',
      'rate_limit_per_user_per_hour',
      'rate_limit_per_user_per_day',
      'digest_mode',
      'fcm_project_id',
      'fcm_service_account_json',
      'apns_team_id',
      'apns_key_id',
      'apns_bundle_id',
      'apns_p8_key',
      'apns_environment',
      -- Inbound email (§23–§29). All plain (non-secret) values:
      'inbound_enabled',                          -- 'true' | 'false' (default off)
      'inbound_domain',                           -- receiving domain, e.g. reply.hulkstein.com
      'inbound_fallback_action',                  -- 'archive' | 'discard' when no route matches
      'inbound_blocked_senders',                  -- CSV of addresses/domains never processed
      'inbound_allowed_senders',                  -- CSV allowlist; empty = allow all
      'inbound_attachment_max_bytes',             -- per-attachment cap (default 10485760)
      'inbound_attachment_allowed_types',         -- CSV of content-type prefixes
      'inbound_rate_limit_per_sender_per_hour',   -- ingestion cap per from_address
      'inbound_retention_days'                    -- purge window for inbound_emails
    ]::text[])
  );
