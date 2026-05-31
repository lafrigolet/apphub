-- verifactu — SIF / facturación verificable (AEAT VERI*FACTU).
--
-- Módulo platform reutilizable por cualquier app. Todo está scopeado por
-- (app_id, tenant_id) con RLS, igual que el resto de módulos platform.
--
-- ⚠️ V1 = skeleton realista: el modelo de dominio se persiste de verdad y
-- el portal lee datos reales, pero las piezas que dependen de specs
-- oficiales de la AEAT (orden de campos de la huella, firma XAdES, WSDL del
-- SOAP de remisión, parámetros del QR) van como STUBS marcados TODO en el
-- código de servicio. No emite contra la AEAT real.
--
-- El schema y el rol svc_platform_verifactu se provisionan en
-- infra/postgres/init/01_platform_schemas.sql; aquí sólo creamos tablas.

------------------------------------------------------------------
-- updated_at touch trigger
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_verifactu.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

------------------------------------------------------------------
-- 1. Registros de facturación (alta / anulación) + huella encadenada
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.registros (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id           TEXT         NOT NULL,
  tenant_id        UUID         NOT NULL,
  sub_tenant_id    UUID,
  numero           INTEGER,                                      -- nº de secuencia en la cadena (display "128")
  num_serie        TEXT         NOT NULL,                        -- "2027-A/000128"
  tipo             TEXT         NOT NULL DEFAULT 'alta'
                                  CHECK (tipo IN ('alta','anulacion')),
  tipo_factura     TEXT         NOT NULL DEFAULT 'F1',
  modalidad        TEXT         NOT NULL DEFAULT 'VERIFACTU'
                                  CHECK (modalidad IN ('VERIFACTU','NO_VERIFACTU')),
  cliente_nombre   TEXT,
  cliente_nif      TEXT,
  fecha_expedicion TEXT,                                         -- display dd-mm-yyyy (demo)
  importe_total    NUMERIC(14,2),
  cuota_total      NUMERIC(14,2),
  total_display    TEXT,                                         -- "1.452,00 €" (es-ES)
  estado_remision  TEXT         NOT NULL DEFAULT 'pendiente'
                                  CHECK (estado_remision IN ('pendiente','ok','warn','err')),
  huella           TEXT,                                         -- SHA-256 (stub) — ver lib/huella.js
  huella_anterior  TEXT,
  qr_url           TEXT,
  generado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vf_registros_tenant
  ON platform_verifactu.registros (app_id, tenant_id, numero DESC);

------------------------------------------------------------------
-- 2. Eventos del SIF (arranque, export, anomalía, login, restore…)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.eventos (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  sub_tenant_id UUID,
  tag           TEXT         NOT NULL,                           -- ARRANQUE / EXPORT / ANOMALÍA / LOGIN / RESTORE
  tone          TEXT         NOT NULL DEFAULT 'azul',            -- pill tone (azul/emerald/amber/slate)
  descripcion   TEXT         NOT NULL,
  ts_display    TEXT,                                            -- "02-01 08:00:11"
  ocurrido_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vf_eventos_tenant
  ON platform_verifactu.eventos (app_id, tenant_id, ocurrido_en DESC);

------------------------------------------------------------------
-- 3. Lotes de remisión a la AEAT
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.lotes (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  sub_tenant_id UUID,
  codigo        TEXT         NOT NULL,                           -- "LOTE-2027-0042"
  info          TEXT,                                            -- "847 registros · 9 NIF"
  label         TEXT,                                            -- "Completado" / "Enviando" / ...
  tone          TEXT         NOT NULL DEFAULT 'azul',
  pulse         BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vf_lotes_tenant
  ON platform_verifactu.lotes (app_id, tenant_id, created_at DESC);

------------------------------------------------------------------
-- 4. Clientes (cartera de la asesoría) + apoderamiento (representación)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.clientes (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                 TEXT         NOT NULL,
  tenant_id              UUID         NOT NULL,
  sub_tenant_id          UUID,
  nombre                 TEXT         NOT NULL,
  nif                    TEXT         NOT NULL,
  facturas_mes           INTEGER      NOT NULL DEFAULT 0,
  estado                 TEXT         NOT NULL DEFAULT 'ok'
                                        CHECK (estado IN ('ok','warn','err')),
  apoderamiento_doc      TEXT,                                   -- "REPR-0012" (NULL = sin apoderamiento)
  apoderamiento_vigencia TEXT,                                   -- "hasta 31-12-2027"
  repr_estado            TEXT,                                   -- "Vigente" / "Pendiente"
  repr_tone              TEXT,                                   -- pill tone
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vf_clientes_tenant
  ON platform_verifactu.clientes (app_id, tenant_id, created_at DESC);

------------------------------------------------------------------
-- 5. Certificados (metadatos; las claves privadas viven en vault/HSM)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.certificados (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  sub_tenant_id UUID,
  nombre        TEXT         NOT NULL,
  meta          TEXT,                                            -- "PKCS#12 · caduca 14-09-2027"
  estado        TEXT         NOT NULL DEFAULT 'Vigente',
  tone          TEXT         NOT NULL DEFAULT 'ok',
  icon_tone     TEXT         NOT NULL DEFAULT 'emerald',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vf_certificados_tenant
  ON platform_verifactu.certificados (app_id, tenant_id, created_at DESC);

------------------------------------------------------------------
-- 6. Control de flujo (parámetros de remisión) — uno por (app, tenant)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.config (
  app_id              TEXT         NOT NULL,
  tenant_id           UUID         NOT NULL,
  tiempo_espera_envio INTEGER      NOT NULL DEFAULT 60,          -- TiempoEsperaEnvio (s)
  max_registros_lote  INTEGER      NOT NULL DEFAULT 1000,        -- ⚠️ verificar límite oficial
  reintentos          INTEGER      NOT NULL DEFAULT 3,
  dlq_enabled         BOOLEAN      NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, tenant_id)
);

------------------------------------------------------------------
-- 7. Cotejos (verificaciones del receptor)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.cotejos (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  sub_tenant_id UUID,
  nif_emisor    TEXT,
  num_serie     TEXT,
  resultado     TEXT         NOT NULL DEFAULT 'verificada'
                              CHECK (resultado IN ('verificada','no_consta')),
  label         TEXT,                                            -- "Verificada" / "No consta"
  tone          TEXT         NOT NULL DEFAULT 'ok',
  ts_display    TEXT,                                            -- "hace 2 min"
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vf_cotejos_tenant
  ON platform_verifactu.cotejos (app_id, tenant_id, created_at DESC);

------------------------------------------------------------------
-- RLS — aislamiento por (app_id, tenant_id) en todas las tablas
------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['registros','eventos','lotes','clientes','certificados','config','cotejos']
  LOOP
    EXECUTE format('ALTER TABLE platform_verifactu.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform_verifactu.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY vf_tenant_isolation ON platform_verifactu.%I
        USING (
          app_id = current_setting('app.app_id', true)
          AND tenant_id = current_setting('app.tenant_id', true)::uuid
        )
    $f$, t);
  END LOOP;
END $$;

------------------------------------------------------------------
-- updated_at triggers (tablas con updated_at)
------------------------------------------------------------------
CREATE TRIGGER trg_vf_registros_touch BEFORE UPDATE ON platform_verifactu.registros
  FOR EACH ROW EXECUTE FUNCTION platform_verifactu.touch_updated_at();
CREATE TRIGGER trg_vf_clientes_touch  BEFORE UPDATE ON platform_verifactu.clientes
  FOR EACH ROW EXECUTE FUNCTION platform_verifactu.touch_updated_at();
CREATE TRIGGER trg_vf_config_touch    BEFORE UPDATE ON platform_verifactu.config
  FOR EACH ROW EXECUTE FUNCTION platform_verifactu.touch_updated_at();
