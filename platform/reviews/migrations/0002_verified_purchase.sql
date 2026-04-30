-- Verified-purchase flag. Set at createReview time when the buyer's JWT lets
-- us look up an order in platform_marketplace.orders that:
--   1) belongs to the same buyer_user_id, and
--   2) is in a post-payment status (paid / fulfilled / shipped / delivered / completed).
-- Soft-fail: if the orders endpoint times out / 5xx, the review still saves
-- with verified_purchase = FALSE.

ALTER TABLE platform_reviews.reviews
  ADD COLUMN IF NOT EXISTS verified_purchase BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for the common query "list verified-only published reviews
-- for this product/vendor".
CREATE INDEX IF NOT EXISTS idx_reviews_target_verified
  ON platform_reviews.reviews (app_id, tenant_id, target_type, target_id)
  WHERE verified_purchase = TRUE AND status = 'published';
