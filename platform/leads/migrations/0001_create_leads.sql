-- Leads — captured from the public Hulkstein landing contact form.
-- No tenant isolation: leads exist BEFORE the prospect becomes a tenant.
-- Staff reads via /v1/leads/admin (requireRole super_admin|staff).
CREATE TABLE IF NOT EXISTS platform_leads.leads (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  contact_name   TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  business_name  TEXT,
  phone          TEXT,
  industry       TEXT
                 CHECK (industry IS NULL OR industry IN ('restaurant', 'gym', 'services', 'shop', 'other')),
  message        TEXT,
  source         TEXT,                       -- 'landing-modal', 'demo-cta', ...
  ip             INET,                       -- captured for abuse triage
  user_agent     TEXT,
  status         TEXT        NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
  staff_notes    TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_status_created
  ON platform_leads.leads (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_email
  ON platform_leads.leads (lower(email));

-- The svc_platform_leads role is provisioned in
-- infra/postgres/init/01_platform_schemas.sql; grants are added there.
