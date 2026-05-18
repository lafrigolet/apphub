-- Self-register + admin-approval flow para tenants que requieren gating
-- (e.g. aikikan). El campo `pending_approval=true` deja al user creado en
-- platform_auth.users pero bloquea el login con 403 PENDING_APPROVAL.
-- Cuando el admin aprueba pasa a FALSE y se dispara un magic-link.
--
-- Distinto de `pending_activation` (que es el flow del owner-bootstrap):
-- pending_activation = user invitado por admin, falta fijar password.
-- pending_approval   = user auto-solicitó, falta que admin apruebe.
-- Ambos bloquean login.

ALTER TABLE platform_auth.users
  ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT FALSE;

-- Index parcial: el listado admin de "pendientes" filtra por este flag,
-- así que un índice limitado a los pocos rows true es suficiente.
CREATE INDEX IF NOT EXISTS idx_platform_auth_users_pending_approval
  ON platform_auth.users (app_id, tenant_id)
  WHERE pending_approval = TRUE;
