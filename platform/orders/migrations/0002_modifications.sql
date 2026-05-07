-- Order modifications: append-only audit log of post-creation changes
-- (added items, removed items, address change, total adjustments). Each
-- entry references the order and captures who made the change. The
-- order itself is mutated in place (totals + items rows recomputed) but
-- this table preserves the trail for accounting and dispute resolution.
--
-- Note: status changes already go to platform_orders.status_changes
-- (migration 0001). This table is for non-status mutations.
CREATE TABLE IF NOT EXISTS platform_orders.order_modifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  tenant_id       UUID NOT NULL,
  order_id        UUID NOT NULL REFERENCES platform_orders.orders(id) ON DELETE CASCADE,
  modification_type TEXT NOT NULL CHECK (modification_type IN (
    'item_added', 'item_removed', 'item_qty_changed',
    'shipping_address_changed', 'note_added', 'totals_adjusted'
  )),
  before_value    JSONB,
  after_value     JSONB,
  reason          TEXT,
  actor_user_id   UUID,
  actor_role      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_orders_modifications_order
  ON platform_orders.order_modifications (order_id, created_at DESC);

ALTER TABLE platform_orders.order_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_orders.order_modifications FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_orders_modifications_isolation
  ON platform_orders.order_modifications
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT
  ON platform_orders.order_modifications
  TO svc_platform_orders;

-- Cross-schema read of platform_auth.users so changeStatus can hydrate the
-- buyer's email into the published order.<status> event. Failure is
-- swallowed by the service (logged as warn) so missing auth grants don't
-- break the FSM — but having the grant in place avoids the warning when
-- everything is wired correctly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_orders')
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_auth')
  THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_auth TO svc_platform_orders';
    EXECUTE 'GRANT SELECT ON platform_auth.users TO svc_platform_orders';
  END IF;
END
$$;
