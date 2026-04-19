ALTER TABLE yoga_reporting.daily_metrics
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

-- Rebuild primary key to include tenant_id
ALTER TABLE yoga_reporting.daily_metrics DROP CONSTRAINT IF EXISTS daily_metrics_pkey;
ALTER TABLE yoga_reporting.daily_metrics ADD PRIMARY KEY (tenant_id, date);

ALTER TABLE yoga_reporting.ratings
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_yoga_ratings_tenant ON yoga_reporting.ratings (tenant_id);

ALTER TABLE yoga_reporting.instructor_ratings_summary
  ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

CREATE INDEX IF NOT EXISTS idx_yoga_instructor_summary_tenant ON yoga_reporting.instructor_ratings_summary (tenant_id);

ALTER TABLE yoga_reporting.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_reporting.daily_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_daily_metrics_tenant_isolation ON yoga_reporting.daily_metrics
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE yoga_reporting.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_reporting.ratings FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_ratings_tenant_isolation ON yoga_reporting.ratings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE yoga_reporting.instructor_ratings_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_reporting.instructor_ratings_summary FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_instructor_summary_tenant_isolation ON yoga_reporting.instructor_ratings_summary
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
