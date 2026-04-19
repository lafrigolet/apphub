-- Split Pay Core schema (distinct from legacy 'payments' schema used by services/split-payments)

CREATE SCHEMA IF NOT EXISTS splitpay_core;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_splitpay_core') THEN
    CREATE ROLE svc_splitpay_core LOGIN PASSWORD 'splitpay_core_secret';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA splitpay_core TO svc_splitpay_core;

ALTER DEFAULT PRIVILEGES IN SCHEMA splitpay_core
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_splitpay_core;
ALTER DEFAULT PRIVILEGES IN SCHEMA splitpay_core
  GRANT USAGE, SELECT ON SEQUENCES TO svc_splitpay_core;
