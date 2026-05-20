-- Donaciones — infraestructura plataforma (V1).
--
-- Soporta:
--   * One-shot vs recurring_monthly
--   * Anónimas vs identificadas
--   * Donante registrado (user) vs invitado (sólo email)
--   * Fondo general (cause_id NULL) vs causa específica
--   * Fiscal: NIF opcional, certificado anual, export modelo 182
--
-- Multi-tenant: aislamiento por (app_id, tenant_id) con RLS forzada.
-- Cualquier app de la plataforma puede usar este módulo emitiendo el
-- header de autenticación correspondiente.
--
-- El schema y el rol svc_platform_donations se provisionan en
-- infra/postgres/init/01_platform_schemas.sql; aquí sólo creamos tablas.

------------------------------------------------------------------
-- 1. Causas / campañas (opcional)
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_donations.causes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  sub_tenant_id   UUID,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  target_cents    BIGINT,
  raised_cents    BIGINT NOT NULL DEFAULT 0,
  currency        CHAR(3) NOT NULL DEFAULT 'EUR',
  image_object_id UUID,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  position        INTEGER NOT NULL DEFAULT 0,
  starts_at       DATE,
  ends_at         DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, sub_tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_donations_causes_active
  ON platform_donations.causes (app_id, tenant_id, active, position);

ALTER TABLE platform_donations.causes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_donations.causes FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_donations_causes_isolation
  ON platform_donations.causes
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 2. Suscripciones recurrentes (Stripe Subscription)
--    Se crea antes de donations porque donations puede referenciarla.
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_donations.donation_subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                   TEXT NOT NULL,
  tenant_id                UUID NOT NULL,
  sub_tenant_id            UUID,
  cause_id                 UUID REFERENCES platform_donations.causes(id) ON DELETE SET NULL,
  donor_user_id            UUID,
  donor_email              TEXT NOT NULL,
  donor_name               TEXT,
  donor_nif                TEXT,
  amount_cents             BIGINT NOT NULL CHECK (amount_cents > 0),
  currency                 CHAR(3) NOT NULL DEFAULT 'EUR',
  status                   TEXT NOT NULL CHECK (status IN ('active','past_due','cancelled','incomplete')),
  stripe_subscription_id   TEXT NOT NULL UNIQUE,
  stripe_customer_id       TEXT NOT NULL,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donation_subs_donor
  ON platform_donations.donation_subscriptions (app_id, tenant_id, donor_user_id)
  WHERE donor_user_id IS NOT NULL;

ALTER TABLE platform_donations.donation_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_donations.donation_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_donations_subs_isolation
  ON platform_donations.donation_subscriptions
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 3. Donaciones individuales (incluye row "pending" antes del pago)
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_donations.donations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                   TEXT NOT NULL,
  tenant_id                UUID NOT NULL,
  sub_tenant_id            UUID,
  cause_id                 UUID REFERENCES platform_donations.causes(id) ON DELETE SET NULL,
  donor_user_id            UUID,                          -- NULL si invitado o anónimo
  donor_email              TEXT NOT NULL,                 -- siempre — para envío del recibo
  donor_name               TEXT,
  donor_nif                TEXT,                          -- habilita certificado fiscal
  donor_address            TEXT,                          -- modelo 182 lo pide
  donor_postal_code        TEXT,
  donor_country            CHAR(2),                       -- ISO 3166-1 alpha-2
  amount_cents             BIGINT NOT NULL CHECK (amount_cents > 0),
  currency                 CHAR(3) NOT NULL DEFAULT 'EUR',
  status                   TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','paid','failed','refunded')),
  kind                     TEXT NOT NULL CHECK (kind IN ('one_shot','recurring_monthly')),
  anonymous                BOOLEAN NOT NULL DEFAULT FALSE,
  message                  TEXT,
  stripe_session_id        TEXT,
  stripe_payment_intent_id TEXT,
  subscription_id          UUID REFERENCES platform_donations.donation_subscriptions(id) ON DELETE SET NULL,
  paid_at                  TIMESTAMPTZ,
  refunded_at              TIMESTAMPTZ,
  refund_reason            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donations_tenant_paid
  ON platform_donations.donations (app_id, tenant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_donations_donor
  ON platform_donations.donations (donor_user_id)
  WHERE donor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_donations_nif_year
  ON platform_donations.donations (app_id, tenant_id, donor_nif, paid_at)
  WHERE donor_nif IS NOT NULL AND status = 'paid';
CREATE INDEX IF NOT EXISTS idx_donations_session
  ON platform_donations.donations (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_donations_cause
  ON platform_donations.donations (cause_id)
  WHERE cause_id IS NOT NULL;

ALTER TABLE platform_donations.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_donations.donations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_donations_donations_isolation
  ON platform_donations.donations
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 4. Certificados anuales (idempotente por año/donante)
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_donations.fiscal_certificates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  fiscal_year     INTEGER NOT NULL,
  donor_nif       TEXT NOT NULL,
  donor_email     TEXT NOT NULL,
  donor_name      TEXT,
  total_cents     BIGINT NOT NULL,
  donation_ids    UUID[] NOT NULL,
  pdf_object_id   UUID,                          -- ref a platform_storage.objects
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  UNIQUE (app_id, tenant_id, fiscal_year, donor_nif)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_certs_year
  ON platform_donations.fiscal_certificates (app_id, tenant_id, fiscal_year);

ALTER TABLE platform_donations.fiscal_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_donations.fiscal_certificates FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_donations_certs_isolation
  ON platform_donations.fiscal_certificates
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );
