-- 0008 — Remisión real a la AEAT + certificados PKCS#12 cifrados + refs cruzadas.
--
-- Cierra el camino crítico de Veri*Factu (recomendaciones #2/#3/#5/#7/#8):
--
--  A) Refs cruzadas + idempotencia (uso §15): los registros pueden originarse en
--     un pos.bill.closed / order.completed / donation.created. Se persisten
--     order_id/donation_id/bill_id EN EL REGISTRO (inmutable, se fija en el
--     INSERT) con índices únicos parciales → un evento reentregado no genera un
--     segundo registro (anti doble emisión).
--
--  B) Cola de remisión (uso §5/§17): los `registros` son APPEND-ONLY a nivel de
--     motor (trigger deny_mutation, migración 0007), así que el estado MUTABLE de
--     la remisión (pendiente→enviando→ok/warn/err/dlq, intentos, CSV, error,
--     firma enviada) NO puede vivir en `registros`. Vive aquí, una fila por
--     registro a remitir. Las vistas de lista hacen LEFT JOIN para mostrar el
--     estado vivo sin tocar la cadena inmutable.
--
--  C) Certificados PKCS#12 (uso §12): la clave privada del certificado cualificado
--     se guarda CIFRADA (AES-256-GCM vía @apphub/platform-sdk/crypto, clave
--     PLATFORM_CONFIG_ENCRYPTION_KEY) — nunca en claro. Se extraen y persisten los
--     metadatos reales (CN, emisor, nº de serie, caducidad, uso firma/sello).
--
--  D) Lotes (uso §5): se ligan a la respuesta real de la AEAT (EstadoEnvio, CSV).

------------------------------------------------------------------
-- A) Refs cruzadas + idempotencia en registros (set en el INSERT; inmutable)
------------------------------------------------------------------
ALTER TABLE platform_verifactu.registros
  ADD COLUMN IF NOT EXISTS origen      TEXT,   -- 'tpv'|'orders'|'pos'|'donations'|'manual'
  ADD COLUMN IF NOT EXISTS order_id    TEXT,
  ADD COLUMN IF NOT EXISTS donation_id TEXT,
  ADD COLUMN IF NOT EXISTS bill_id     TEXT;

-- Un registro por documento de origen → impide doble emisión si el evento Redis
-- llega dos veces (dedupe declarativo a nivel de motor).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vf_registros_order
  ON platform_verifactu.registros (app_id, tenant_id, order_id)    WHERE order_id    IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vf_registros_donation
  ON platform_verifactu.registros (app_id, tenant_id, donation_id) WHERE donation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vf_registros_bill
  ON platform_verifactu.registros (app_id, tenant_id, bill_id)     WHERE bill_id     IS NOT NULL;

------------------------------------------------------------------
-- B) Cola de remisión — estado mutable de cada registro frente a la AEAT
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_verifactu.remision_queue (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  registro_id     UUID         NOT NULL REFERENCES platform_verifactu.registros(id),
  num_serie       TEXT         NOT NULL,
  estado          TEXT         NOT NULL DEFAULT 'pendiente'
                                 CHECK (estado IN ('pendiente','enviando','ok','warn','err','dlq')),
  intentos        INTEGER      NOT NULL DEFAULT 0,
  max_intentos    INTEGER      NOT NULL DEFAULT 3,        -- snapshot de config.reintentos al encolar
  proximo_intento TIMESTAMPTZ  NOT NULL DEFAULT now(),    -- back-off: no reintentar antes de esta hora
  entorno         TEXT         NOT NULL DEFAULT 'test'
                                 CHECK (entorno IN ('test','prod')),
  lote_codigo     TEXT,                                   -- lote en el que se remitió
  estado_aeat     TEXT,                                   -- EstadoRegistro de la RespuestaLinea
  csv_aeat        TEXT,                                   -- CSV (código seguro de verificación) por registro
  codigo_error    TEXT,                                   -- CodigoErrorRegistro
  ultimo_error    TEXT,                                   -- DescripcionErrorRegistro / error de transporte
  firma_xades     TEXT,                                   -- firma XAdES del RegistroAlta enviado (si aplica)
  remitido_en     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, registro_id)                 -- una entrada de cola por registro
);

-- El worker (platform-scheduler) busca los pendientes/reintentos vencidos por
-- estado + proximo_intento; este índice cubre ese scan cross-tenant.
CREATE INDEX IF NOT EXISTS idx_vf_remision_due
  ON platform_verifactu.remision_queue (estado, proximo_intento);
CREATE INDEX IF NOT EXISTS idx_vf_remision_tenant
  ON platform_verifactu.remision_queue (app_id, tenant_id, created_at DESC);

ALTER TABLE platform_verifactu.remision_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_verifactu.remision_queue FORCE  ROW LEVEL SECURITY;
CREATE POLICY vf_tenant_isolation ON platform_verifactu.remision_queue
  USING (
    app_id = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TRIGGER trg_vf_remision_touch BEFORE UPDATE ON platform_verifactu.remision_queue
  FOR EACH ROW EXECUTE FUNCTION platform_verifactu.touch_updated_at();

------------------------------------------------------------------
-- C) Certificados PKCS#12 — clave privada cifrada at-rest + metadatos reales
------------------------------------------------------------------
ALTER TABLE platform_verifactu.certificados
  ADD COLUMN IF NOT EXISTS pkcs12_cifrado     BYTEA,   -- PKCS#12 completo (con clave privada), AES-256-GCM
  ADD COLUMN IF NOT EXISTS passphrase_cifrada BYTEA,   -- passphrase del PKCS#12, AES-256-GCM
  ADD COLUMN IF NOT EXISTS cn                 TEXT,    -- Common Name del sujeto
  ADD COLUMN IF NOT EXISTS emisor             TEXT,    -- CN de la CA emisora (FNMT, …)
  ADD COLUMN IF NOT EXISTS numero_serie       TEXT,    -- nº de serie del certificado
  ADD COLUMN IF NOT EXISTS caduca_en          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS uso                TEXT DEFAULT 'firma'   -- 'firma' (persona) | 'sello' (empresa)
                                                CHECK (uso IS NULL OR uso IN ('firma','sello')),
  ADD COLUMN IF NOT EXISTS activo             BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TRIGGER trg_vf_certificados_touch BEFORE UPDATE ON platform_verifactu.certificados
  FOR EACH ROW EXECUTE FUNCTION platform_verifactu.touch_updated_at();

------------------------------------------------------------------
-- D) Lotes — respuesta real de la AEAT
------------------------------------------------------------------
ALTER TABLE platform_verifactu.lotes
  ADD COLUMN IF NOT EXISTS estado_envio  TEXT,        -- EstadoEnvio: Correcto/ParcialmenteCorrecto/Incorrecto
  ADD COLUMN IF NOT EXISTS csv           TEXT,        -- CSV del envío
  ADD COLUMN IF NOT EXISTS num_registros INTEGER,
  ADD COLUMN IF NOT EXISTS entorno       TEXT,
  ADD COLUMN IF NOT EXISTS respondido_en TIMESTAMPTZ;
