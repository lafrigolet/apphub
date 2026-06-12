-- Dedup de leads recurrentes (use-cases leads.md §4). Cuando llega una nueva
-- alta (formulario público o email entrante) con el mismo email que un lead
-- ABIERTO, el servicio adjunta el mensaje al lead existente en vez de duplicar.
-- Este índice parcial hace esa búsqueda barata. Solo cubre estados vivos: un
-- prospecto que reaparece tras un won/lost es una oportunidad NUEVA, no un
-- duplicado, así que esos no se deduplican.
CREATE INDEX IF NOT EXISTS idx_leads_open_email
  ON platform_leads.leads (lower(email))
  WHERE status IN ('new', 'contacted', 'qualified');
