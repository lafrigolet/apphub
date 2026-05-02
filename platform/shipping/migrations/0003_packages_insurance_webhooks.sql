-- Shipping upgrades:
--   1. Multi-package per shipment (one shipment can have N parcels with
--      individual tracking codes — common for furniture / kits / refunds
--      that ship in stages).
--   2. Insurance + signature_required flags on shipments (passed through
--      to the carrier when generating labels).
--   3. Carrier webhook events table — append-only log of every payload
--      received from UPS/FedEx/DHL/EasyPost, used both as audit trail and
--      idempotency anchor (we ignore duplicate event_external_id).

-- 1. Per-package rows ---------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_shipping.shipment_packages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  shipment_id     UUID         NOT NULL REFERENCES platform_shipping.shipments(id) ON DELETE CASCADE,
  package_number  INT          NOT NULL,                        -- 1..N within the shipment
  carrier         TEXT,
  tracking_code   TEXT,
  weight_grams    INT,
  length_mm       INT,
  width_mm        INT,
  height_mm       INT,
  status          TEXT         NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','shipped','in_transit','delivered','returned','lost')),
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, package_number)
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_packages_shipment
  ON platform_shipping.shipment_packages (shipment_id);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_packages_tracking
  ON platform_shipping.shipment_packages (tracking_code)
  WHERE tracking_code IS NOT NULL;

ALTER TABLE platform_shipping.shipment_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.shipment_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_packages_isolation ON platform_shipping.shipment_packages
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_shipping.shipment_packages
  TO svc_platform_shipping;

-- 2. Insurance + signature flags ---------------------------------------
ALTER TABLE platform_shipping.shipments
  ADD COLUMN IF NOT EXISTS insurance_amount_cents INT,
  ADD COLUMN IF NOT EXISTS insurance_currency     TEXT,
  ADD COLUMN IF NOT EXISTS signature_required     BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Carrier webhook events log ----------------------------------------
CREATE TABLE IF NOT EXISTS platform_shipping.carrier_webhook_events (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id              TEXT,                                       -- nullable: webhooks may come in before tenant resolution
  tenant_id           UUID,
  carrier             TEXT         NOT NULL,                       -- 'ups' | 'fedex' | 'dhl' | 'easypost' | …
  event_external_id   TEXT,                                        -- carrier's own id; uniqueness used for idempotency
  shipment_id         UUID         REFERENCES platform_shipping.shipments(id) ON DELETE SET NULL,
  package_id          UUID         REFERENCES platform_shipping.shipment_packages(id) ON DELETE SET NULL,
  payload             JSONB        NOT NULL,
  signature_valid     BOOLEAN,
  processed_at        TIMESTAMPTZ,
  received_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (carrier, event_external_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_webhook_unprocessed
  ON platform_shipping.carrier_webhook_events (carrier, received_at DESC)
  WHERE processed_at IS NULL;

GRANT SELECT, INSERT, UPDATE
  ON platform_shipping.carrier_webhook_events
  TO svc_platform_shipping;
