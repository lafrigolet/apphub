ALTER TABLE yoga_bookings.bookings
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

ALTER TABLE yoga_bookings.waiting_list
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_yoga_bookings_tenant  ON yoga_bookings.bookings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_yoga_waitlist_tenant  ON yoga_bookings.waiting_list (tenant_id);

ALTER TABLE yoga_bookings.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_bookings.bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_bookings_tenant_isolation ON yoga_bookings.bookings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE yoga_bookings.waiting_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_bookings.waiting_list FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_waitlist_tenant_isolation ON yoga_bookings.waiting_list
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
