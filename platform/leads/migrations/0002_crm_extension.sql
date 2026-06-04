-- CRM extension — implementa los casos de uso priorizados de
-- docs/use-cases/leads.md: asignación, won/lost + lost_reason, atribución
-- UTM, consentimiento LOPDGDD, conversión lead→tenant, snooze/follow-up,
-- tags/custom_fields y timeline de actividad con autor.

ALTER TABLE platform_leads.leads
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS assigned_to         UUID,        -- staff owner (platform_auth user id)
  ADD COLUMN IF NOT EXISTS score               SMALLINT
                           CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS lost_reason         TEXT,
  ADD COLUMN IF NOT EXISTS tags                TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS custom_fields       JSONB,
  ADD COLUMN IF NOT EXISTS app_id              TEXT,        -- atribución opcional: ¿de qué portal vino?
  -- Atribución de marketing (single-touch, capturada en el alta)
  ADD COLUMN IF NOT EXISTS utm_source          TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium          TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign        TEXT,
  ADD COLUMN IF NOT EXISTS utm_term            TEXT,
  ADD COLUMN IF NOT EXISTS utm_content         TEXT,
  ADD COLUMN IF NOT EXISTS referrer            TEXT,
  ADD COLUMN IF NOT EXISTS landing_url         TEXT,
  -- Consentimiento LOPDGDD/GDPR (texto + versión mostrados al captar)
  ADD COLUMN IF NOT EXISTS consent_text        TEXT,
  ADD COLUMN IF NOT EXISTS consent_version     TEXT,
  ADD COLUMN IF NOT EXISTS consent_at          TIMESTAMPTZ,
  -- Snooze / "volver a contactar el …"
  ADD COLUMN IF NOT EXISTS next_follow_up_at   TIMESTAMPTZ,
  -- Conversión: trazabilidad lead → tenant provisionado
  ADD COLUMN IF NOT EXISTS converted_tenant_id UUID,
  ADD COLUMN IF NOT EXISTS converted_at        TIMESTAMPTZ;

-- Estados: won/lost sustituyen al cierre genérico. 'closed' se mantiene
-- admitido por compatibilidad con filas históricas (se filtra como cerrado).
ALTER TABLE platform_leads.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE platform_leads.leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost', 'closed'));

-- Timeline de actividad. Sustituye al staff_notes plano (que se mantiene
-- como campo legacy): notas con autor, historial de transiciones de estado,
-- asignaciones y registro de llamadas/emails/reuniones.
CREATE TABLE IF NOT EXISTS platform_leads.lead_activities (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID        NOT NULL REFERENCES platform_leads.leads(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_user_id  UUID,                -- NULL en entradas de sistema
  author_email    TEXT,
  type            TEXT        NOT NULL
                  CHECK (type IN ('note', 'status_change', 'assignment',
                                  'email', 'call', 'meeting', 'system')),
  body            TEXT,
  metadata        JSONB                -- p.ej. { "from": "new", "to": "contacted" }
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead
  ON platform_leads.lead_activities (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_assigned
  ON platform_leads.leads (assigned_to) WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_follow_up
  ON platform_leads.leads (next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_updated
  ON platform_leads.leads (status, updated_at DESC);
