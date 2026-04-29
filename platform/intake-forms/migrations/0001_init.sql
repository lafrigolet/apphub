-- Intake forms module: pre-appointment questionnaires.
-- Templates are versioned (publishing creates a new version).

CREATE TABLE IF NOT EXISTS platform_intake_forms.templates (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  code          TEXT         NOT NULL,
  name          TEXT         NOT NULL,
  description   TEXT,
  schema        JSONB        NOT NULL,
  version       INT          NOT NULL DEFAULT 1,
  is_published  BOOLEAN      NOT NULL DEFAULT FALSE,
  requires_signature BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_intake_templates_tenant_code
  ON platform_intake_forms.templates (tenant_id, code, version);
ALTER TABLE platform_intake_forms.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_intake_forms.templates FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_intake_templates_isolation ON platform_intake_forms.templates
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_intake_forms.submissions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  template_id     UUID         NOT NULL REFERENCES platform_intake_forms.templates (id),
  booking_id      UUID,
  client_user_id  UUID         NOT NULL,
  answers         JSONB        NOT NULL DEFAULT '{}',
  signature_url   TEXT,
  signed_at       TIMESTAMPTZ,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','submitted','reviewed')),
  submitted_at    TIMESTAMPTZ,
  reviewed_by_user_id UUID,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_intake_submissions_booking
  ON platform_intake_forms.submissions (booking_id);
CREATE INDEX IF NOT EXISTS idx_platform_intake_submissions_status
  ON platform_intake_forms.submissions (tenant_id, status, created_at DESC);
ALTER TABLE platform_intake_forms.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_intake_forms.submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_intake_submissions_isolation ON platform_intake_forms.submissions
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- intake-forms reads platform_services to detect requires_intake_form on booking.confirmed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_intake_forms') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_services TO svc_platform_intake_forms';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_services TO svc_platform_intake_forms';
  END IF;
END
$$;
