-- commerce — orquestación de comercio.
--
-- Convierte un PAGO (platform/payments) en una COMPRA CUMPLIDA sin cruzar
-- esquemas: cada módulo dueño escribe lo suyo, dirigido por eventos.
--
--   1. El portal crea un checkout (POST /v1/commerce/checkouts) con la intención
--      de compra (kind=package → comprar bono; kind=booking → pagar reserva).
--   2. El portal crea la sesión de pago en platform/payments y enlaza el
--      transaction id al checkout (PATCH .../checkouts/:id { providerTxId }).
--   3. Al cobrar, payments emite `payment.succeeded`; commerce casa el checkout
--      por provider_tx_id, lo marca `paid` y emite `commerce.purchase.paid`.
--   4. El módulo dueño consume ese evento y cumple: packages crea el bono,
--      bookings confirma la reserva. (cada uno escribe SU esquema)
--
-- El schema y el rol svc_platform_commerce se provisionan en
-- infra/postgres/init/01_platform_schemas.sql; aquí sólo creamos tablas.

CREATE OR REPLACE FUNCTION platform_commerce.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS platform_commerce.checkouts (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  kind            TEXT         NOT NULL CHECK (kind IN ('package', 'booking')),
  ref_id          TEXT         NOT NULL,         -- package template id | booking id
  client_user_id  UUID,
  amount_cents    INTEGER      NOT NULL,
  currency        TEXT         NOT NULL DEFAULT 'EUR',
  status          TEXT         NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'paid', 'fulfilled', 'failed', 'expired')),
  provider_tx_id  TEXT,                          -- transacción de platform/payments (enlace)
  fulfillment     JSONB,                         -- p.ej. { purchaseId } / { confirmed: true }
  metadata        JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commerce_checkouts_tenant
  ON platform_commerce.checkouts (app_id, tenant_id, created_at DESC);

-- Casamos el pago por provider_tx_id → único cuando está informado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_checkouts_tx
  ON platform_commerce.checkouts (provider_tx_id) WHERE provider_tx_id IS NOT NULL;

ALTER TABLE platform_commerce.checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_commerce.checkouts FORCE  ROW LEVEL SECURITY;
CREATE POLICY commerce_tenant_isolation ON platform_commerce.checkouts
  USING (
    app_id = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TRIGGER trg_commerce_checkouts_touch BEFORE UPDATE ON platform_commerce.checkouts
  FOR EACH ROW EXECUTE FUNCTION platform_commerce.touch_updated_at();
