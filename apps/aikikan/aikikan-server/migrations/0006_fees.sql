-- Cuotas de socio. Tres recursos:
--   fee_products       — catálogo (matrícula, seguro, suscripción anual).
--                        Editable por staff/admin; el frontend lo lista
--                        para mostrar precios y botones.
--   fee_payments       — un row por intento de cobro (one-shot o
--                        renovación de suscripción). Status reflecta el
--                        estado real en Stripe.
--   fee_subscriptions  — la subscription activa (si existe) por socio.
-- RLS en las tres por (app_id, tenant_id).

-- ── Catálogo ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_aikikan.fee_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  sub_tenant_id   UUID,

  code            TEXT NOT NULL,                   -- 'matricula' | 'seguro' | 'anual'
  name            TEXT NOT NULL,
  description     TEXT,
  amount_cents    INT  NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'eur',
  kind            TEXT NOT NULL,                   -- 'one_shot' | 'recurring_annual'
  interval_months INT,                             -- 12 para 'recurring_annual', NULL one-shot
  stripe_price_id TEXT,                            -- ID del Price en Stripe; null hasta configurar
  active          BOOLEAN NOT NULL DEFAULT true,
  position        INT  NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (app_id, tenant_id, sub_tenant_id, code)
);

ALTER TABLE app_aikikan.fee_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.fee_products FORCE ROW LEVEL SECURITY;
CREATE POLICY fee_products_isolation ON app_aikikan.fee_products
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Seed: tres productos por defecto. amount_cents son ejemplos — el admin
-- los ajusta antes de poner Stripe en marcha. stripe_price_id queda NULL
-- hasta que el admin pegue el ID del Price creado en el dashboard Stripe.
INSERT INTO app_aikikan.fee_products
  (app_id, tenant_id, code, name, description, amount_cents, currency, kind, interval_months, position)
VALUES
  ('aikikan', '30000000-0000-0000-0000-000000000001', 'matricula', 'Cuota de matrícula',     'Pago único de alta como socio.',                                  3000, 'eur', 'one_shot',         NULL, 1),
  ('aikikan', '30000000-0000-0000-0000-000000000001', 'seguro',    'Cuota de seguro anual',  'Cobertura del seguro de práctica deportiva (anual).',             5000, 'eur', 'one_shot',         NULL, 2),
  ('aikikan', '30000000-0000-0000-0000-000000000001', 'anual',     'Suscripción anual',      'Renovación automática anual incluyendo matrícula y seguro.',     8000, 'eur', 'recurring_annual',   12, 3)
ON CONFLICT (app_id, tenant_id, sub_tenant_id, code) DO NOTHING;

-- ── Pagos individuales ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_aikikan.fee_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                TEXT NOT NULL,
  tenant_id             UUID NOT NULL,
  sub_tenant_id         UUID,
  user_id               UUID NOT NULL,

  product_codes         TEXT[] NOT NULL,           -- ['matricula','seguro']
  amount_cents          INT  NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'eur',
  status                TEXT NOT NULL DEFAULT 'pending',  -- pending|paid|failed|refunded
  stripe_session_id     TEXT,
  stripe_payment_intent TEXT,
  stripe_invoice_id     TEXT,                      -- en renovaciones de subscription
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_payments_user
  ON app_aikikan.fee_payments (app_id, tenant_id, user_id, created_at DESC);

ALTER TABLE app_aikikan.fee_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.fee_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY fee_payments_isolation ON app_aikikan.fee_payments
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ── Subscriptions activas ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_aikikan.fee_subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                 TEXT NOT NULL,
  tenant_id              UUID NOT NULL,
  sub_tenant_id          UUID,
  user_id                UUID NOT NULL,

  status                 TEXT NOT NULL,            -- active|past_due|cancelled|incomplete
  stripe_subscription_id TEXT NOT NULL,
  stripe_customer_id     TEXT NOT NULL,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (app_id, tenant_id, user_id)
);

ALTER TABLE app_aikikan.fee_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_aikikan.fee_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY fee_subscriptions_isolation ON app_aikikan.fee_subscriptions
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
