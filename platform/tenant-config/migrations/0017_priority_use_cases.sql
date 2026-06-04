-- Casos de uso prioritarios de tenant-config (doc § "Recomendaciones de
-- priorización"). Agrupa cuatro features backend-only en una sola migración
-- correlativa:
--   #5  Verificación de dominio custom (estado dns_verified + token + ts).
--   #7  Feature flags por tenant (override de enabled_modules del app).
--   #9  Tabla sub_tenants (segundo nivel de la jerarquía que el JWT ya declara).
--   #10 Paginación con cursor del audit log (índice ya cubre (tenant_id, ts)).

-- ── #5 Custom-domain DNS verification ───────────────────────────────────────
-- El campo `custom_domain` ya existe (texto libre). Añadimos el estado de
-- verificación: un token que el tenant publica como TXT record
-- (_apphub-challenge.<domain>) y el timestamp en que se verificó. NGINX seguirá
-- usando <subdomain>.hulkstein.com hasta que el render del server block con
-- dominio custom se wire (cross-cutting); aquí sólo gestionamos el estado.
ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS custom_domain_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_domain_verify_token TEXT,
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at  TIMESTAMPTZ;

-- ── #7 Per-tenant feature flags (enabled_modules override) ───────────────────
-- NULL  = sin override → el tenant hereda `apps.enabled_modules`.
-- ARRAY = override explícito → el shell monta exactamente estos módulos para
--         este tenant, ignorando el array del app.
ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS enabled_modules_override TEXT[];

-- ── #9 sub_tenants ───────────────────────────────────────────────────────────
-- Segundo nivel de tenancy (p.ej. una sucursal/dojo dentro de una federación).
-- El claim JWT ya declara `sub_tenant_id`; esta tabla le da registro real.
-- Aislamiento por (app_id, tenant_id) heredado del tenant padre. El subdominio
-- del sub-tenant es único dentro de su tenant padre (no global).
CREATE TABLE IF NOT EXISTS platform_tenants.sub_tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES platform_tenants.tenants(id) ON DELETE CASCADE,
  app_id       TEXT NOT NULL REFERENCES platform_tenants.apps(app_id) ON UPDATE CASCADE,
  display_name TEXT NOT NULL,
  slug         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sub_tenants_status_check CHECK (status IN ('active', 'suspended', 'archived')),
  CONSTRAINT sub_tenants_slug_unique  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_sub_tenants_tenant ON platform_tenants.sub_tenants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sub_tenants_app    ON platform_tenants.sub_tenants (app_id);

-- El módulo corre como svc_platform_tenants; migrate.js corre como superusuario.
-- Concedemos privilegios de la nueva tabla al rol de aplicación (DO block para
-- no fallar en entornos de test donde el rol pueda no existir).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_tenants') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_tenants.sub_tenants TO svc_platform_tenants;
  END IF;
END$$;
