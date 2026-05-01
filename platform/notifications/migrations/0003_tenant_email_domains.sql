-- Per-tenant verified sending domains. Each row is a domain (e.g. bastardo.com)
-- that a tenant has authenticated with the configured ESP (today: SendGrid).
-- The dns_records JSON holds the CNAMEs the tenant must publish for DKIM /
-- branded link verification; the email service later refuses to send a
-- message whose `from` domain is not present + verified for the caller's tenant.
CREATE TABLE IF NOT EXISTS platform_notifications.tenant_email_domains (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id               TEXT NOT NULL,
  tenant_id            UUID NOT NULL,
  domain               TEXT NOT NULL,
  default_from_local   TEXT,                              -- 'noreply' (without @domain)
  default_from_name    TEXT,
  reply_to_address     TEXT,
  provider             TEXT NOT NULL DEFAULT 'sendgrid'
                       CHECK (provider IN ('sendgrid', 'ses', 'postmark', 'mailgun')),
  provider_domain_id   TEXT,                              -- ESP-side id, used to re-validate
  dns_records          JSONB NOT NULL DEFAULT '[]'::jsonb,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','verified','failed','suspended')),
  last_checked_at      TIMESTAMPTZ,
  verified_at          TIMESTAMPTZ,
  suspended_at         TIMESTAMPTZ,
  suspend_reason       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_platform_notif_email_domains_tenant
  ON platform_notifications.tenant_email_domains (tenant_id, status);

ALTER TABLE platform_notifications.tenant_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_notifications.tenant_email_domains FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_notif_email_domains_isolation
  ON platform_notifications.tenant_email_domains
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_notifications.tenant_email_domains
  TO svc_platform_notifications;
