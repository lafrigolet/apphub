-- Por-tenant: si requires_user_approval=TRUE, los registros nuevos
-- (POST /v1/auth/request-membership y OAuth-auto-create) quedan en
-- pending_approval hasta que un admin del tenant los apruebe.
--
-- Default FALSE — todos los tenants existentes siguen abiertos.
-- Aikikan se flipea explícitamente abajo.

ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS requires_user_approval BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE platform_tenants.tenants
   SET requires_user_approval = TRUE
 WHERE app_id = 'aikikan';

-- Pequeño boundary leak controlado: el módulo auth necesita saber si el
-- tenant requiere aprobación para gatear el flow de OAuth-auto-create
-- (cuando llega un user nuevo via Google/Facebook, hay que setear
-- pending_approval según este flag). El password-based flow lo decide
-- el caller, así que sólo este caso necesita la lectura cross-module.
GRANT USAGE ON SCHEMA platform_tenants TO svc_platform_auth;
GRANT SELECT (id, app_id, requires_user_approval)
  ON platform_tenants.tenants TO svc_platform_auth;
