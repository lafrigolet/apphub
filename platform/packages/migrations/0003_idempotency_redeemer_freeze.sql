-- packages priority use-cases (backend-only):
--   #5 Idempotencia de redención  — booking_id único por (package_id, reason='redeem')
--      para que un booking.completed duplicado no consuma dos sesiones.
--   #6 user_id del redimidor       — saber qué miembro del grupo consumió cada sesión.
--   #9 Congelación / extensión     — pausar / extender la validez (expires_at) del bono.
--   #4 Reembolso monetario         — campos para la cancelación con devolución proporcional.

-- ── #6 redeemer user_id ────────────────────────────────────────────────
ALTER TABLE platform_packages.redemptions
  ADD COLUMN IF NOT EXISTS redeemer_user_id UUID;

-- ── #5 idempotencia de redención ───────────────────────────────────────
-- Un mismo booking sólo puede generar UNA redención de tipo 'redeem'. Los
-- 'refund' (devolución por cancelación) pueden repetir booking_id, por eso
-- el índice parcial se restringe a reason='redeem' AND booking_id NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_packages_redeem_once
  ON platform_packages.redemptions (app_id, tenant_id, booking_id)
  WHERE reason = 'redeem' AND booking_id IS NOT NULL;

-- ── #9 congelación / extensión de validez ──────────────────────────────
ALTER TABLE platform_packages.purchased_packages
  ADD COLUMN IF NOT EXISTS frozen_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS frozen_days_total INT NOT NULL DEFAULT 0;

-- Allow status='frozen' alongside the existing lifecycle states.
ALTER TABLE platform_packages.purchased_packages
  DROP CONSTRAINT IF EXISTS purchased_packages_status_check;
ALTER TABLE platform_packages.purchased_packages
  ADD CONSTRAINT purchased_packages_status_check
  CHECK (status IN ('active','exhausted','expired','refunded','cancelled','frozen'));

-- Side table: full freeze history (start / end / reason) for auditing.
CREATE TABLE IF NOT EXISTS platform_packages.package_freezes (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  package_id      UUID         NOT NULL REFERENCES platform_packages.purchased_packages(id) ON DELETE CASCADE,
  frozen_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  unfrozen_at     TIMESTAMPTZ,
  days_added      INT,
  reason          TEXT,
  actor_user_id   UUID,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_packages_freezes_pkg
  ON platform_packages.package_freezes (package_id, created_at DESC);
ALTER TABLE platform_packages.package_freezes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_packages.package_freezes FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_packages_freezes_isolation
  ON platform_packages.package_freezes
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_packages') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON platform_packages.package_freezes TO svc_platform_packages';
  END IF;
END
$$;
