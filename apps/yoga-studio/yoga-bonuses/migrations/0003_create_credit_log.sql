CREATE TABLE IF NOT EXISTS yoga_bonuses.credit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bonus_id    UUID NOT NULL REFERENCES yoga_bonuses.bonuses(id) ON DELETE CASCADE,
  delta       INT NOT NULL,
  reason      TEXT,
  booking_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yoga_credit_log_bonus ON yoga_bonuses.credit_log (bonus_id, created_at DESC);
