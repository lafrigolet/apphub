-- Inventory module: stock by SKU, scoped to (app_id, tenant_id).

CREATE TABLE IF NOT EXISTS platform_inventory.inventory_items (
  app_id                TEXT      NOT NULL,
  tenant_id             UUID      NOT NULL,
  sku                   TEXT      NOT NULL,
  qty_on_hand           INT       NOT NULL DEFAULT 0,
  qty_reserved          INT       NOT NULL DEFAULT 0,
  low_stock_threshold   INT       NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, tenant_id, sku),
  CHECK (qty_on_hand >= 0),
  CHECK (qty_reserved >= 0),
  CHECK (qty_reserved <= qty_on_hand)
);

CREATE INDEX IF NOT EXISTS idx_platform_inventory_items_tenant
  ON platform_inventory.inventory_items (tenant_id);

ALTER TABLE platform_inventory.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_inventory.inventory_items FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_inventory_items_isolation ON platform_inventory.inventory_items
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Audit trail: every stock change leaves a row.
CREATE TABLE IF NOT EXISTS platform_inventory.stock_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      TEXT      NOT NULL,
  tenant_id   UUID      NOT NULL,
  sku         TEXT      NOT NULL,
  delta       INT       NOT NULL,
  reason      TEXT      NOT NULL,                                                -- 'reserve' | 'release' | 'commit' | 'adjust' | 'restock'
  ref_type    TEXT,                                                              -- e.g. 'order'
  ref_id      UUID,
  actor_user_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_inventory_movements_tenant_sku
  ON platform_inventory.stock_movements (tenant_id, sku, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_inventory_movements_ref
  ON platform_inventory.stock_movements (ref_type, ref_id);

ALTER TABLE platform_inventory.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_inventory.stock_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_inventory_movements_isolation ON platform_inventory.stock_movements
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
