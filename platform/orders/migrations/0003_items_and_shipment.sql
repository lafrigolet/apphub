-- 0003: post-creation item editing + shipment linkage.
--
-- (1) shipment_id on orders — closes the order→shipping loop. When the order
--     transitions to `fulfilled` the FSM already publishes `order.fulfilled`;
--     the shipping module reacts and emits `shipping.shipment.created`, which
--     this module consumes to backfill `shipment_id` for traceability. The
--     existing `shipping.shipment.delivered` consumer keeps advancing the FSM.
--
-- (2) updated_at on order_items — lets the post-creation item editor touch a
--     row and have a deterministic timestamp for the modification audit trail.
--     (qty / price changes are mutated in place; order_modifications keeps the
--     append-only before/after diff.)
--
-- No new tables: item edits reuse platform_orders.order_modifications
-- (migration 0002) whose CHECK already allows item_added / item_removed /
-- item_qty_changed / totals_adjusted.

ALTER TABLE platform_orders.orders
  ADD COLUMN IF NOT EXISTS shipment_id UUID;

CREATE INDEX IF NOT EXISTS idx_platform_orders_orders_shipment
  ON platform_orders.orders (shipment_id)
  WHERE shipment_id IS NOT NULL;

ALTER TABLE platform_orders.order_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
