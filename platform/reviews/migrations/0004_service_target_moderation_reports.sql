-- Reviews · priority backend extensions (use-case recommendations 6, 7, 9):
--
--  6. target_type 'service' — unblocks platform/appointments reviews.
--  7. moderation basics — moderation_reason on the review row + a pending
--     queue (served by an indexed status filter).
--  9. review reports — a per-review abuse-report table (spam / fake / etc.)
--     so buyers, vendors or third parties can flag a review for staff review.
--
-- All tables stay scoped to (app_id, tenant_id) with RLS, like the rest of
-- the module. No existing migration is edited.

-- ── 6. Allow 'service' as a review target ───────────────────────────────
-- CHECK constraints can't be altered in place; drop + recreate the column
-- constraint with the widened value set.
ALTER TABLE platform_reviews.reviews
  DROP CONSTRAINT IF EXISTS reviews_target_type_check;
ALTER TABLE platform_reviews.reviews
  ADD CONSTRAINT reviews_target_type_check
  CHECK (target_type IN ('product', 'vendor', 'service'));

-- ── 7. Moderation reason ────────────────────────────────────────────────
ALTER TABLE platform_reviews.reviews
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

-- Pending-queue lookups: list reviews awaiting moderation per tenant,
-- newest first. Partial index keeps it small even on busy tenants.
CREATE INDEX IF NOT EXISTS idx_platform_reviews_pending
  ON platform_reviews.reviews (app_id, tenant_id, created_at DESC)
  WHERE status = 'pending';

-- ── 9. Review reports / abuse flags ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_reviews.review_reports (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            TEXT         NOT NULL,
  tenant_id         UUID         NOT NULL,
  review_id         UUID         NOT NULL REFERENCES platform_reviews.reviews(id) ON DELETE CASCADE,
  reporter_user_id  UUID         NOT NULL,
  reason            TEXT         NOT NULL CHECK (reason IN ('spam', 'fake', 'inappropriate', 'misinformation', 'incentivized', 'other')),
  detail            TEXT,
  status            TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- One report per (reporter, review): re-reporting upserts the latest reason.
  UNIQUE (review_id, reporter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_reviews_reports_review
  ON platform_reviews.review_reports (review_id);

-- Open-reports queue per tenant (staff moderation triage).
CREATE INDEX IF NOT EXISTS idx_platform_reviews_reports_open
  ON platform_reviews.review_reports (app_id, tenant_id, created_at DESC)
  WHERE status = 'open';

ALTER TABLE platform_reviews.review_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reviews.review_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reviews_reports_isolation ON platform_reviews.review_reports
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_reviews.review_reports
  TO svc_platform_reviews;
