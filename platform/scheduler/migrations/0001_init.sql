-- Scheduler module: audit log of every cron tick + cross-schema grants needed
-- by the runtime role to read and (sparingly) write into other modules' tables.

CREATE TABLE IF NOT EXISTS platform_scheduler.runs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      TEXT         NOT NULL,
  started_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT         NOT NULL CHECK (status IN ('running','success','error','skipped_locked')),
  rows_affected INT,
  error         TEXT,
  metadata      JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_platform_scheduler_runs_job_started
  ON platform_scheduler.runs (job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_scheduler_runs_status
  ON platform_scheduler.runs (status, started_at DESC);

-- Note: runs table is global (no app_id / tenant_id). Querying it requires
-- staff role at the API layer. RLS is intentionally NOT enabled.

-- BYPASSRLS — the scheduler queries cross-tenant without setting RLS session
-- vars. Per-tenant isolation is still enforced at the API layer of every
-- module that wraps queries with set_config'd app_id + tenant_id.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_scheduler') THEN
    EXECUTE 'ALTER ROLE svc_platform_scheduler BYPASSRLS';
  END IF;
END
$$;

-- Cross-schema grants for svc_platform_scheduler. Each block is conditional so
-- the migration is safe even if a schema doesn't exist yet (e.g. on a fresh
-- platform-core-only install). Same pattern as availability migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_scheduler') THEN

    -- platform_bookings — the scheduler reads bookings + booking_events +
    -- booking_resources + recurrences and writes the reminder_*_sent_at columns.
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_bookings') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA platform_bookings TO svc_platform_scheduler';
      EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform_bookings TO svc_platform_scheduler';
    END IF;

    -- platform_availability — the scheduler purges expired holds.
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_availability') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA platform_availability TO svc_platform_scheduler';
      EXECUTE 'GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA platform_availability TO svc_platform_scheduler';
    END IF;

    -- platform_packages — read + UPDATE (warning_*_sent_at, status=expired).
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_packages') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA platform_packages TO svc_platform_scheduler';
      EXECUTE 'GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA platform_packages TO svc_platform_scheduler';
    END IF;

    -- platform_practitioner_payouts — read schedules + UPDATE last_closed_at.
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_practitioner_payouts') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA platform_practitioner_payouts TO svc_platform_scheduler';
      EXECUTE 'GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA platform_practitioner_payouts TO svc_platform_scheduler';
    END IF;

    -- platform_reservations — read + UPDATE reminder_*_sent_at.
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_reservations') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA platform_reservations TO svc_platform_scheduler';
      EXECUTE 'GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA platform_reservations TO svc_platform_scheduler';
    END IF;

    -- platform_disputes — read + UPDATE sla_breached_at.
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_disputes') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA platform_disputes TO svc_platform_scheduler';
      EXECUTE 'GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA platform_disputes TO svc_platform_scheduler';
    END IF;

    -- platform_storage — DELETE pending orphans + UPDATE retention status.
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'platform_storage') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA platform_storage TO svc_platform_scheduler';
      EXECUTE 'GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform_storage TO svc_platform_scheduler';
    END IF;

  END IF;
END
$$;
