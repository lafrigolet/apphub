CREATE TABLE IF NOT EXISTS yoga_bonuses.bonuses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  bonus_type_id   UUID NOT NULL REFERENCES yoga_bonuses.bonus_types(id),
  sessions_used   INT NOT NULL DEFAULT 0,
  sessions_total  INT NOT NULL,
  starts_at       DATE NOT NULL,
  expires_at      DATE NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  activated_by    VARCHAR(20) NOT NULL DEFAULT 'payment' CHECK (activated_by IN ('payment', 'manual')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yoga_bonuses_user_active ON yoga_bonuses.bonuses (user_id, expires_at) WHERE is_active = true;
