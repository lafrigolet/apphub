-- Reviews module: ratings + replies, scoped to (app_id, tenant_id).

CREATE TABLE IF NOT EXISTS platform_reviews.reviews (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  target_type     TEXT         NOT NULL CHECK (target_type IN ('product', 'vendor')),
  target_id       TEXT         NOT NULL,
  order_id        UUID,
  buyer_user_id   UUID         NOT NULL,
  rating          INT          NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           TEXT,
  body            TEXT,
  status          TEXT         NOT NULL DEFAULT 'published' CHECK (status IN ('pending', 'published', 'hidden', 'removed')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Prevent duplicate review per (buyer, order, target).
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_reviews_unique_buyer_target
  ON platform_reviews.reviews (app_id, tenant_id, buyer_user_id, target_type, target_id, COALESCE(order_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_platform_reviews_target
  ON platform_reviews.reviews (app_id, tenant_id, target_type, target_id, status);

CREATE INDEX IF NOT EXISTS idx_platform_reviews_order
  ON platform_reviews.reviews (order_id);

ALTER TABLE platform_reviews.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reviews.reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reviews_isolation ON platform_reviews.reviews
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_reviews.review_replies (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  review_id       UUID         NOT NULL REFERENCES platform_reviews.reviews (id) ON DELETE CASCADE,
  vendor_user_id  UUID         NOT NULL,
  body            TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_reviews_replies_review
  ON platform_reviews.review_replies (review_id);

ALTER TABLE platform_reviews.review_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reviews.review_replies FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reviews_replies_isolation ON platform_reviews.review_replies
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
