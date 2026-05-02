-- Returns / RMA (Return Merchandise Authorization) flow.
--
-- Two tables:
--   returns      — header row, holds the FSM status, totals and links to the
--                  original order + (optional) inbound shipment.
--   return_items — per-line breakdown (sku, qty, reason, condition).
--
-- Status FSM (enforced in service code):
--   requested → approved   → label_issued → shipped → received → restocked → refunded
--             ↘ rejected
--             ↘ cancelled (also from approved)
--
-- Refund + restock are recorded via timestamps rather than separate states so
-- staff can mark them done independently (you can refund without restocking
-- if the item came back damaged).

CREATE TABLE IF NOT EXISTS platform_shipping.returns (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id               TEXT         NOT NULL,
  tenant_id            UUID         NOT NULL,
  order_id             UUID         NOT NULL,
  buyer_user_id        UUID         NOT NULL,
  status               TEXT         NOT NULL DEFAULT 'requested'
                       CHECK (status IN ('requested','approved','rejected','label_issued',
                                         'shipped','received','restocked','refunded','cancelled')),
  inbound_shipment_id  UUID         REFERENCES platform_shipping.shipments(id),
  carrier              TEXT,
  tracking_code        TEXT,
  reason               TEXT,
  decision_notes       TEXT,
  refund_amount_cents  INT,
  refund_currency      TEXT,
  refunded_at          TIMESTAMPTZ,
  restocked_at         TIMESTAMPTZ,
  approved_at          TIMESTAMPTZ,
  rejected_at          TIMESTAMPTZ,
  shipped_at           TIMESTAMPTZ,
  received_at          TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_returns_order
  ON platform_shipping.returns (app_id, tenant_id, order_id);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_returns_buyer
  ON platform_shipping.returns (app_id, tenant_id, buyer_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_returns_status
  ON platform_shipping.returns (tenant_id, status);

ALTER TABLE platform_shipping.returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.returns FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_returns_isolation ON platform_shipping.returns
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_shipping.returns
  TO svc_platform_shipping;


CREATE TABLE IF NOT EXISTS platform_shipping.return_items (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  return_id       UUID         NOT NULL REFERENCES platform_shipping.returns(id) ON DELETE CASCADE,
  sku             TEXT         NOT NULL,
  qty             INT          NOT NULL CHECK (qty > 0),
  qty_received    INT          NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  reason          TEXT,
  condition       TEXT         CHECK (condition IS NULL OR condition IN ('new','open_box','used','damaged','missing')),
  unit_price_cents INT,
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_return_items_return
  ON platform_shipping.return_items (return_id);

ALTER TABLE platform_shipping.return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.return_items FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_return_items_isolation ON platform_shipping.return_items
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_shipping.return_items
  TO svc_platform_shipping;
