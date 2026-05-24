-- Inquiries — formulario de contacto per-tenant.
--
-- Caso de uso V1: un visitante anónimo envía un mensaje desde el portal
-- de un app concreto (aikikan/aulavera/...). Persistimos la consulta y
-- publicamos un evento `inquiry.created` para que platform/notifications
-- mande:
--   1) Un email alert al admin del tenant (a contact_inbox_email).
--   2) Un email "gracias" al user con la referencia.
--
-- No hay conversación in-app en V1 — el admin contesta desde su email
-- personal usando el Reply-To que apunta al user. V2 puede añadir una
-- tabla inquiry_messages encima de este schema sin breaking.
--
-- El schema y el rol svc_platform_inquiries se provisionan en
-- infra/postgres/init/01_platform_schemas.sql; aquí sólo creamos tablas.

------------------------------------------------------------------
-- 1. Consultas
------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_inquiries.inquiries (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       TEXT         NOT NULL UNIQUE,                -- "INQ-20260524-A3B7K2" (citable por teléfono)
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  contact_name    TEXT         NOT NULL,
  email           TEXT         NOT NULL,
  phone           TEXT,
  subject         TEXT,                                        -- opcional — depende del form de cada app
  message         TEXT         NOT NULL,
  source          TEXT,                                        -- 'footer-modal' / 'contacto-page' / ...
  metadata        JSONB        NOT NULL DEFAULT '{}',          -- libre para que el app añada lo que quiera
  status          TEXT         NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new','contacted','closed','spam')),
  staff_notes     TEXT,                                        -- audit interno
  ip              INET,                                        -- captado para triaje anti-spam
  user_agent      TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  contacted_at    TIMESTAMPTZ,                                 -- stamp en transition new→contacted
  closed_at       TIMESTAMPTZ                                  -- stamp en transition *→closed|spam
);

CREATE INDEX IF NOT EXISTS idx_inquiries_tenant_status
  ON platform_inquiries.inquiries (app_id, tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inquiries_email
  ON platform_inquiries.inquiries (lower(email));

ALTER TABLE platform_inquiries.inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_inquiries.inquiries FORCE  ROW LEVEL SECURITY;

CREATE POLICY inquiries_tenant_isolation ON platform_inquiries.inquiries
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

------------------------------------------------------------------
-- 2. Settings per (app, tenant)
------------------------------------------------------------------
-- contact_inbox_email es obligatorio para que el create() del servicio
-- pueda disparar el alert. Sin row → 422 al primer POST público.

CREATE TABLE IF NOT EXISTS platform_inquiries.settings (
  app_id              TEXT         NOT NULL,
  tenant_id           UUID         NOT NULL,
  contact_inbox_email TEXT         NOT NULL,                   -- destino del email-alert al admin
  reply_to_email      TEXT,                                    -- Reply-To del "gracias" al user (default: contact_inbox_email)
  user_thanks_subject TEXT,                                    -- override del default por app/tenant
  user_thanks_body    TEXT,                                    -- override (texto plano)
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, tenant_id)
);

ALTER TABLE platform_inquiries.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_inquiries.settings FORCE  ROW LEVEL SECURITY;

CREATE POLICY inquiries_settings_isolation ON platform_inquiries.settings
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

------------------------------------------------------------------
-- 3. Auto-update updated_at en cada UPDATE
------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_inquiries.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inquiries_touch_updated_at ON platform_inquiries.inquiries;
CREATE TRIGGER trg_inquiries_touch_updated_at
  BEFORE UPDATE ON platform_inquiries.inquiries
  FOR EACH ROW EXECUTE FUNCTION platform_inquiries.touch_updated_at();

DROP TRIGGER IF EXISTS trg_inquiries_settings_touch_updated_at ON platform_inquiries.settings;
CREATE TRIGGER trg_inquiries_settings_touch_updated_at
  BEFORE UPDATE ON platform_inquiries.settings
  FOR EACH ROW EXECUTE FUNCTION platform_inquiries.touch_updated_at();
