-- TPV — operación de caja y cumplimiento fiscal (V1). Ver docs/use-cases/tpv.md
-- y docs/adr/015-platform-tpv-monolith.md.
--
-- El motor de cuentas (bills/pagos/splits) vive en platform_pos; este schema
-- añade la capa de caja: dispositivos, sesiones/turnos, efectivo, recibos con
-- numeración correlativa sin huecos + snapshot inmutable, abonos, informes Z.
--
-- Multi-tenant: aislamiento por (app_id, tenant_id) con RLS forzada, mismo
-- patrón que platform_donations. El schema y el rol svc_platform_tpv se
-- provisionan en infra/postgres/init/01_platform_schemas.sql.

------------------------------------------------------------------
-- 1. Dispositivos TPV (terminales / SIF emisores)
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.tpv_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  sub_tenant_id   UUID,
  name            TEXT NOT NULL,
  location        TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (app_id, tenant_id, sub_tenant_id, name)
);

ALTER TABLE platform_tpv.tpv_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.tpv_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_devices_isolation
  ON platform_tpv.tpv_devices
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 2. Series de numeración correlativa (sin huecos)
--    El correlativo vive en next_number y se consume con
--    UPDATE ... RETURNING dentro de la MISMA transacción que inserta
--    el recibo/abono: el lock de fila serializa, el rollback no
--    consume número. Nunca Redis.
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.number_series (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  sub_tenant_id   UUID,
  code            TEXT NOT NULL,                    -- 'A', 'B', 'R', …
  kind            TEXT NOT NULL CHECK (kind IN ('simplified','invoice','credit_note')),
  prefix          TEXT NOT NULL DEFAULT '',         -- se antepone al número en num_serie
  next_number     BIGINT NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  device_id       UUID REFERENCES platform_tpv.tpv_devices(id) ON DELETE SET NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (app_id, tenant_id, sub_tenant_id, code)
);

ALTER TABLE platform_tpv.number_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.number_series FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_series_isolation
  ON platform_tpv.number_series
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

-- Serie por defecto del dispositivo (FK circular con tpv_devices → se añade aquí)
ALTER TABLE platform_tpv.tpv_devices
  ADD COLUMN IF NOT EXISTS default_series_id UUID REFERENCES platform_tpv.number_series(id) ON DELETE SET NULL;

------------------------------------------------------------------
-- 3. Sesiones / turnos de caja
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.cash_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id               TEXT NOT NULL,
  tenant_id            UUID NOT NULL,
  sub_tenant_id        UUID,
  device_id            UUID NOT NULL REFERENCES platform_tpv.tpv_devices(id),
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','force_closed')),
  opened_by            UUID NOT NULL,
  closed_by            UUID,
  opening_float_cents  BIGINT NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),
  declared_close       JSONB,                       -- conteo declarado por método: {"cash": 12345, "card": ...}
  theoretical_close    JSONB,                       -- teórico calculado al cierre
  variance_cents       BIGINT,                      -- declarado - teórico (solo efectivo)
  variance_reason      TEXT,
  opened_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una única sesión abierta por dispositivo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpv_sessions_open_per_device
  ON platform_tpv.cash_sessions (device_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_tpv_sessions_tenant_opened
  ON platform_tpv.cash_sessions (app_id, tenant_id, opened_at DESC);

ALTER TABLE platform_tpv.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.cash_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_sessions_isolation
  ON platform_tpv.cash_sessions
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 4. Arqueos intermedios (recuento ciego) — append-only
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.cash_counts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  sub_tenant_id   UUID,
  session_id      UUID NOT NULL REFERENCES platform_tpv.cash_sessions(id),
  counted_by      UUID NOT NULL,
  counted         JSONB NOT NULL,                   -- declarado: {"cash": 12345} o por denominación
  expected_cents  BIGINT NOT NULL,                  -- teórico de efectivo en el momento del arqueo
  variance_cents  BIGINT NOT NULL,
  note            TEXT,
  counted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpv_counts_session
  ON platform_tpv.cash_counts (session_id, counted_at DESC);

ALTER TABLE platform_tpv.cash_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.cash_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_counts_isolation
  ON platform_tpv.cash_counts
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 5. Movimientos de efectivo — append-only, importes con signo
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.cash_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id           TEXT NOT NULL,
  tenant_id        UUID NOT NULL,
  sub_tenant_id    UUID,
  session_id       UUID NOT NULL REFERENCES platform_tpv.cash_sessions(id),
  kind             TEXT NOT NULL CHECK (kind IN ('sale_cash','cash_in','cash_out','refund_cash','opening_float')),
  amount_cents     BIGINT NOT NULL CHECK (
                     (kind IN ('sale_cash','cash_in','opening_float') AND amount_cents > 0)
                     OR (kind IN ('cash_out','refund_cash') AND amount_cents < 0)
                   ),
  reason           TEXT,
  actor_id         UUID,                            -- NULL si source='event'
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','event')),
  billing_fact_id  UUID,                            -- trazabilidad venta → movimiento
  receipt_id       UUID,                            -- trazabilidad abono → movimiento
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpv_movements_session
  ON platform_tpv.cash_movements (session_id, created_at);

ALTER TABLE platform_tpv.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.cash_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_movements_isolation
  ON platform_tpv.cash_movements
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 6. Billing facts — snapshot del bill pagado en pos (cola de emisión)
--    Llega vía evento pos.bill.paid. Idempotente por (app, tenant, bill).
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.billing_facts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  sub_tenant_id   UUID,
  bill_id         TEXT NOT NULL,                    -- referencia textual a platform_pos.bills (sin FK cross-schema)
  device_id       UUID REFERENCES platform_tpv.tpv_devices(id),
  session_id      UUID REFERENCES platform_tpv.cash_sessions(id),
  currency        CHAR(3) NOT NULL DEFAULT 'EUR',
  subtotal_cents  BIGINT NOT NULL DEFAULT 0,
  tax_cents       BIGINT NOT NULL DEFAULT 0,
  tip_cents       BIGINT NOT NULL DEFAULT 0,
  total_cents     BIGINT NOT NULL DEFAULT 0,
  payments        JSONB NOT NULL DEFAULT '[]',      -- [{method, amountCents, tipCents, externalRef}]
  lines           JSONB NOT NULL DEFAULT '[]',      -- [{sku, name, qty, unitPriceCents, modifiers, course}]
  bill_metadata   JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','receipted','cancelled')),
  attributed      BOOLEAN NOT NULL DEFAULT FALSE,   -- true si el cash se imputó a una sesión
  receipt_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, bill_id)
);

CREATE INDEX IF NOT EXISTS idx_tpv_facts_status
  ON platform_tpv.billing_facts (app_id, tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tpv_facts_orphan
  ON platform_tpv.billing_facts (app_id, tenant_id, created_at DESC)
  WHERE session_id IS NULL;

ALTER TABLE platform_tpv.billing_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.billing_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_facts_isolation
  ON platform_tpv.billing_facts
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 7. Recibos — snapshot fiscal inmutable
--    Sin UPDATE salvo los campos fiscales async (verifactu/QR) — el
--    snapshot de la venta no se toca jamás (grants al final).
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.receipts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                    TEXT NOT NULL,
  tenant_id                 UUID NOT NULL,
  sub_tenant_id             UUID,
  series_id                 UUID NOT NULL REFERENCES platform_tpv.number_series(id),
  number                    BIGINT NOT NULL,
  num_serie                 TEXT NOT NULL,            -- p.ej. 'A-000123' (prefix + code + número)
  type                      TEXT NOT NULL CHECK (type IN ('simplified','invoice')),
  billing_fact_id           UUID REFERENCES platform_tpv.billing_facts(id),
  bill_id                   TEXT NOT NULL,
  device_id                 UUID REFERENCES platform_tpv.tpv_devices(id),
  session_id                UUID REFERENCES platform_tpv.cash_sessions(id),
  currency                  CHAR(3) NOT NULL DEFAULT 'EUR',
  subtotal_cents            BIGINT NOT NULL,
  tax_cents                 BIGINT NOT NULL,
  total_cents               BIGINT NOT NULL,
  tax_breakdown             JSONB NOT NULL DEFAULT '[]',  -- [{rate, baseCents, quotaCents}]
  issuer                    JSONB NOT NULL,               -- snapshot emisor: {nif, name, address, postalCode, city, country}
  receptor_nif              TEXT,
  receptor_name             TEXT,
  receptor_address          TEXT,
  converted_from_receipt_id UUID REFERENCES platform_tpv.receipts(id),  -- canje simplificado → factura
  status                    TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','voided','converted')),
  verifactu_status          TEXT NOT NULL DEFAULT 'pending' CHECK (verifactu_status IN ('pending','registered','failed')),
  verifactu_num_serie       TEXT,
  qr_payload                TEXT,
  qr_data_uri               TEXT,
  issued_by                 UUID,
  issued_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, series_id, number),
  -- factura completa exige datos fiscales del receptor
  CHECK (type <> 'invoice' OR (receptor_nif IS NOT NULL AND receptor_name IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_tpv_receipts_tenant_issued
  ON platform_tpv.receipts (app_id, tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_tpv_receipts_session
  ON platform_tpv.receipts (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE platform_tpv.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_receipts_isolation
  ON platform_tpv.receipts
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 8. Líneas de recibo — snapshot (relacional para agregar IVA en SQL)
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.receipt_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id           TEXT NOT NULL,
  tenant_id        UUID NOT NULL,
  sub_tenant_id    UUID,
  receipt_id       UUID NOT NULL REFERENCES platform_tpv.receipts(id) ON DELETE CASCADE,
  sku              TEXT,
  name             TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents BIGINT NOT NULL,
  tax_rate         NUMERIC(5,2) NOT NULL,            -- 21.00, 10.00, 4.00, 0.00
  line_base_cents  BIGINT NOT NULL,
  line_tax_cents   BIGINT NOT NULL,
  modifiers        JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpv_receipt_lines_receipt
  ON platform_tpv.receipt_lines (receipt_id);

ALTER TABLE platform_tpv.receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.receipt_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_receipt_lines_isolation
  ON platform_tpv.receipt_lines
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 9. Abonos (credit notes) — siempre ligados al recibo original
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.credit_notes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id               TEXT NOT NULL,
  tenant_id            UUID NOT NULL,
  sub_tenant_id        UUID,
  -- el correlativo se consume al AUTORIZAR (no al solicitar): un abono
  -- rechazado no quema número. CHECK al final del bloque.
  series_id            UUID REFERENCES platform_tpv.number_series(id),
  number               BIGINT,
  num_serie            TEXT,
  original_receipt_id  UUID NOT NULL REFERENCES platform_tpv.receipts(id),
  reason               TEXT NOT NULL,
  amount_cents         BIGINT NOT NULL CHECK (amount_cents > 0),
  lines                JSONB NOT NULL DEFAULT '[]',  -- líneas devueltas (parcial) o todas (total)
  refund_method        TEXT NOT NULL CHECK (refund_method IN ('card','cash')),
  refund_external_ref  TEXT,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','authorized','rejected')),
  requested_by         UUID,
  authorized_by        UUID,
  verifactu_status     TEXT NOT NULL DEFAULT 'pending' CHECK (verifactu_status IN ('pending','registered','failed')),
  verifactu_num_serie  TEXT,
  qr_payload           TEXT,
  qr_data_uri          TEXT,
  issued_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, series_id, number),
  CHECK (status <> 'authorized' OR (series_id IS NOT NULL AND number IS NOT NULL AND num_serie IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_tpv_credit_notes_original
  ON platform_tpv.credit_notes (original_receipt_id);

ALTER TABLE platform_tpv.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.credit_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_credit_notes_isolation
  ON platform_tpv.credit_notes
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 10. Informes Z — snapshot inmutable del cierre de sesión
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.z_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  sub_tenant_id   UUID,
  session_id      UUID NOT NULL REFERENCES platform_tpv.cash_sessions(id),
  number          BIGINT NOT NULL,
  snapshot        JSONB NOT NULL,                    -- ventas por método, IVA por tipo, propinas, brutas/netas, variance
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, session_id),
  UNIQUE (app_id, tenant_id, number)
);

ALTER TABLE platform_tpv.z_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.z_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_zreports_isolation
  ON platform_tpv.z_reports
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 11. Settings por tenant (no secreto, RLS) — incluye el emisor
--     fiscal: cada tenant es una entidad legal distinta.
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.settings (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                            TEXT NOT NULL,
  tenant_id                         UUID NOT NULL,
  sub_tenant_id                     UUID,
  issuer_nif                        TEXT,
  issuer_name                       TEXT,
  issuer_address                    TEXT,
  issuer_postal_code                TEXT,
  issuer_city                       TEXT,
  issuer_country                    CHAR(2) NOT NULL DEFAULT 'ES',
  auto_issue_simplified             BOOLEAN NOT NULL DEFAULT FALSE,
  cash_out_manager_threshold_cents  BIGINT NOT NULL DEFAULT 10000,
  session_autoclose_hours           INTEGER NOT NULL DEFAULT 16,
  convert_window_days               INTEGER NOT NULL DEFAULT 30,
  default_simplified_series_code    TEXT NOT NULL DEFAULT 'A',
  default_invoice_series_code       TEXT NOT NULL DEFAULT 'B',
  default_credit_note_series_code   TEXT NOT NULL DEFAULT 'R',
  receipt_footer                    TEXT,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (app_id, tenant_id, sub_tenant_id)
);

ALTER TABLE platform_tpv.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tpv.settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tpv_settings_isolation
  ON platform_tpv.settings
  USING (
    current_setting('app.staff_access', true) = 'true'
    OR (
      app_id    = current_setting('app.app_id', true)
      AND tenant_id = (current_setting('app.tenant_id', true))::uuid
    )
  );

------------------------------------------------------------------
-- 12. Config service-level (defaults de plataforma + secretos futuros).
--     Patrón estándar de módulos (cifrado AES-256-GCM vía platform-sdk).
--     Sin RLS por tenant: solo staff/super_admin la toca.
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_tpv.config (
  key             TEXT PRIMARY KEY CHECK (key IN (
                    'default_session_autoclose_hours',
                    'default_cash_out_manager_threshold_cents',
                    'receipt_render_footer'
                  )),
  encrypted_value BYTEA,
  plain_value     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

------------------------------------------------------------------
-- 13. Inmutabilidad por grants — el rol del servicio no puede tocar
--     los snapshots. UPDATE solo en columnas fiscales async (verifactu)
--     y en status (void/convert). Guard por si el rol no existe (tests).
------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_tpv') THEN
    -- append-only puros: ni UPDATE ni DELETE
    REVOKE UPDATE, DELETE ON platform_tpv.cash_movements  FROM svc_platform_tpv;
    REVOKE UPDATE, DELETE ON platform_tpv.cash_counts     FROM svc_platform_tpv;
    REVOKE UPDATE, DELETE ON platform_tpv.z_reports       FROM svc_platform_tpv;
    REVOKE UPDATE, DELETE ON platform_tpv.receipt_lines   FROM svc_platform_tpv;
    -- recibos: snapshot intocable; UPDATE solo fiscal async + status + updated_at
    REVOKE UPDATE, DELETE ON platform_tpv.receipts        FROM svc_platform_tpv;
    GRANT  UPDATE (verifactu_status, verifactu_num_serie, qr_payload, qr_data_uri, status, updated_at)
      ON platform_tpv.receipts TO svc_platform_tpv;
    -- abonos: igual, más el flujo de autorización (que asigna el correlativo)
    REVOKE UPDATE, DELETE ON platform_tpv.credit_notes    FROM svc_platform_tpv;
    GRANT  UPDATE (verifactu_status, verifactu_num_serie, qr_payload, qr_data_uri,
                   status, authorized_by, refund_external_ref, issued_at,
                   series_id, number, num_serie, updated_at)
      ON platform_tpv.credit_notes TO svc_platform_tpv;
  END IF;
END
$$;
