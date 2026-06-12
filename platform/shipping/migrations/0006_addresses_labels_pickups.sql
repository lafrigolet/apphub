-- EasyPost outbound integration — close the shipping loop origin→destination:
--   1. addresses — first-class origin (tenant warehouse) + destination (buyer)
--      addresses, reusable across shipments and required by carrier APIs to
--      rate-shop and generate labels. Caches the verified EasyPost address id.
--   2. shipment_packages — per-parcel label artifacts: the carrier shipment id,
--      the bought rate id, the carrier-hosted label/tracking URLs, and the S3
--      key of our own archived PDF copy (via @apphub/platform-sdk/storage).
--   3. shipments — link to from/to addresses + the parent EasyPost shipment id.
--   4. pickups — carrier pickup requests scheduled for an origin address,
--      optionally covering a set of shipments.
--
-- Tenant isolation by (app_id, tenant_id) with RLS, same policy shape as the
-- rest of platform_shipping. Carrier credentials stay global in `settings`.

-- 1. Addresses ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_shipping.addresses (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id              TEXT         NOT NULL,
  tenant_id           UUID         NOT NULL,
  role                TEXT         NOT NULL DEFAULT 'destination'
                      CHECK (role IN ('origin', 'destination')),
  label               TEXT,                                    -- e.g. 'Main warehouse'
  name                TEXT,
  company             TEXT,
  phone               TEXT,
  email               TEXT,
  street1             TEXT         NOT NULL,
  street2             TEXT,
  city                TEXT         NOT NULL,
  region              TEXT,                                    -- state/province code
  zip                 TEXT,
  country             TEXT         NOT NULL,                   -- ISO 3166-1 alpha-2
  is_default          BOOLEAN      NOT NULL DEFAULT FALSE,     -- default ship-from for origins
  verified            BOOLEAN      NOT NULL DEFAULT FALSE,
  easypost_address_id TEXT,                                    -- cached after verify
  metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_addresses_tenant_role
  ON platform_shipping.addresses (app_id, tenant_id, role);

-- At most one default origin address per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_shipping_addresses_default_origin
  ON platform_shipping.addresses (app_id, tenant_id)
  WHERE role = 'origin' AND is_default = TRUE;

ALTER TABLE platform_shipping.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_addresses_isolation ON platform_shipping.addresses
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_shipping.addresses
  TO svc_platform_shipping;

-- 2. Per-parcel label artifacts ----------------------------------------
-- Inherit the table's existing GRANTs + RLS (ADD COLUMN needs no re-grant).
ALTER TABLE platform_shipping.shipment_packages
  ADD COLUMN IF NOT EXISTS easypost_shipment_id TEXT,
  ADD COLUMN IF NOT EXISTS easypost_rate_id     TEXT,
  ADD COLUMN IF NOT EXISTS label_url            TEXT,         -- carrier-hosted label
  ADD COLUMN IF NOT EXISTS label_s3_key         TEXT,         -- our archived PDF copy
  ADD COLUMN IF NOT EXISTS tracking_url         TEXT,         -- carrier tracking page
  ADD COLUMN IF NOT EXISTS rate_cents           BIGINT,       -- bought rate amount
  ADD COLUMN IF NOT EXISTS rate_currency        TEXT;

-- 3. Shipment ↔ addresses + parent carrier shipment --------------------
ALTER TABLE platform_shipping.shipments
  ADD COLUMN IF NOT EXISTS from_address_id      UUID
    REFERENCES platform_shipping.addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_address_id        UUID
    REFERENCES platform_shipping.addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS easypost_shipment_id TEXT;

-- 4. Carrier pickups ----------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_shipping.pickups (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id              TEXT         NOT NULL,
  tenant_id           UUID         NOT NULL,
  address_id          UUID         REFERENCES platform_shipping.addresses(id) ON DELETE SET NULL,
  easypost_pickup_id  TEXT,
  status              TEXT         NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','confirmed','cancelled','failed')),
  carrier             TEXT,
  service             TEXT,
  confirmation        TEXT,                                    -- carrier confirmation number
  min_datetime        TIMESTAMPTZ,
  max_datetime        TIMESTAMPTZ,
  instructions        TEXT,
  shipment_ids        UUID[]       NOT NULL DEFAULT '{}',      -- shipments covered by the pickup
  rate                JSONB,                                   -- selected pickup rate
  metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_shipping_pickups_tenant
  ON platform_shipping.pickups (app_id, tenant_id, status);

ALTER TABLE platform_shipping.pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_shipping.pickups FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_shipping_pickups_isolation ON platform_shipping.pickups
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_shipping.pickups
  TO svc_platform_shipping;
