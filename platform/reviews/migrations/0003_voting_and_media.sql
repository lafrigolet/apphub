-- Reviews: helpful/unhelpful voting + photo/video attachments via storage.
--
-- Voting model: a user votes once per review (upsert on (review_id, voter_user_id))
-- with vote_value ∈ {-1, +1}. Aggregates (helpful_count / unhelpful_count) live
-- on the review row to avoid a JOIN on every list query, kept in sync by the
-- service layer (no DB triggers — keeps the cross-table dance visible in code).
--
-- Media model: each row points at an existing platform_storage.objects id.
-- The storage module owns lifecycle (upload TTL, retention, content-type
-- validation). We just store the foreign id + a display order.

CREATE TABLE IF NOT EXISTS platform_reviews.review_votes (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  review_id       UUID         NOT NULL REFERENCES platform_reviews.reviews(id) ON DELETE CASCADE,
  voter_user_id   UUID         NOT NULL,
  vote_value      INT          NOT NULL CHECK (vote_value IN (-1, 1)),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (review_id, voter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_reviews_votes_review
  ON platform_reviews.review_votes (review_id);

ALTER TABLE platform_reviews.review_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reviews.review_votes FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reviews_votes_isolation ON platform_reviews.review_votes
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_reviews.review_votes
  TO svc_platform_reviews;

ALTER TABLE platform_reviews.reviews
  ADD COLUMN IF NOT EXISTS helpful_count   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unhelpful_count INT NOT NULL DEFAULT 0;

-- Photo/video attachments — each one references an object owned by the
-- storage module. RLS by (app_id, tenant_id); cascade-delete on review.
CREATE TABLE IF NOT EXISTS platform_reviews.review_media (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  review_id       UUID         NOT NULL REFERENCES platform_reviews.reviews(id) ON DELETE CASCADE,
  object_id       UUID         NOT NULL,        -- platform_storage.objects.id
  kind            TEXT         NOT NULL CHECK (kind IN ('photo', 'video')),
  display_order   INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_reviews_media_review
  ON platform_reviews.review_media (review_id, display_order);

ALTER TABLE platform_reviews.review_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reviews.review_media FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reviews_media_isolation ON platform_reviews.review_media
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_reviews.review_media
  TO svc_platform_reviews;
