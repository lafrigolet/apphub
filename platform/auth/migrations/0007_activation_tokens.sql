-- Tenant bootstrap: owners se crean sin password y la fijan al consumir
-- el magic-link enviado por staff. Hasta entonces:
--   * password_hash IS NULL  → no pueden hacer login normal.
--   * pending_activation = true → bloquea cualquier ruta que no sea activate.
-- Una vez activados: password_hash se setea, pending_activation = false,
-- owner_activated_at = now().

ALTER TABLE platform_auth.users
  ADD COLUMN IF NOT EXISTS pending_activation  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_activated_at  TIMESTAMPTZ;

-- password_hash debe poder ser NULL para usuarios pre-activación. El
-- servicio garantiza que sólo owners con pending_activation=true tienen
-- password_hash NULL; el resto (registrados con password) sigue NOT NULL
-- por contrato del propio createUser.
ALTER TABLE platform_auth.users
  ALTER COLUMN password_hash DROP NOT NULL;

-- Magic-link tokens. Guardamos sha256 del token plano para que un dump
-- de BD no sea suficiente para activar; el plano sólo viaja en el email.
CREATE TABLE IF NOT EXISTS platform_auth.activation_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES platform_auth.users(id) ON DELETE CASCADE,
  app_id        TEXT NOT NULL,
  tenant_id     UUID NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_auth_activation_user
  ON platform_auth.activation_tokens (user_id)
  WHERE consumed_at IS NULL;

-- RLS: el token_hash funciona como contraseña efímera, así que todas las
-- consultas pasan por staff_access (auth.service usa el bypass al validar
-- /v1/auth/activate, igual que hace login con resolveUserTenant).
ALTER TABLE platform_auth.activation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_auth.activation_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_auth_activation_isolation ON platform_auth.activation_tokens
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY platform_auth_activation_staff_access ON platform_auth.activation_tokens
  USING (current_setting('app.staff_access', true) = 'true');
