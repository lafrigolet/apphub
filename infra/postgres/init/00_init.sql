-- SplitPay Platform — PostgreSQL initialisation
-- Runs once when the container is first created.

-- Create schemas (one per microservice)
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS notifications;
CREATE SCHEMA IF NOT EXISTS tenants;

-- Create dedicated roles with access only to their own schema
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_payments') THEN
    CREATE ROLE svc_payments LOGIN PASSWORD 'svc_payments_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_auth') THEN
    CREATE ROLE svc_auth LOGIN PASSWORD 'svc_auth_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_notifications') THEN
    CREATE ROLE svc_notifications LOGIN PASSWORD 'svc_notifications_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_tenants') THEN
    CREATE ROLE svc_tenants LOGIN PASSWORD 'svc_tenants_secret';
  END IF;
END
$$;

-- Grant schema usage — each role only sees its own schema
GRANT USAGE ON SCHEMA payments      TO svc_payments;
GRANT USAGE ON SCHEMA auth          TO svc_auth;
GRANT USAGE ON SCHEMA notifications TO svc_notifications;
GRANT USAGE ON SCHEMA tenants       TO svc_tenants;

-- Default privileges: future tables in each schema are accessible to the right role
ALTER DEFAULT PRIVILEGES IN SCHEMA payments
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_payments;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_notifications;
ALTER DEFAULT PRIVILEGES IN SCHEMA tenants
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_tenants;

-- Allow sequence usage for each role
ALTER DEFAULT PRIVILEGES IN SCHEMA payments
  GRANT USAGE, SELECT ON SEQUENCES TO svc_payments;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT USAGE, SELECT ON SEQUENCES TO svc_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications
  GRANT USAGE, SELECT ON SEQUENCES TO svc_notifications;
ALTER DEFAULT PRIVILEGES IN SCHEMA tenants
  GRANT USAGE, SELECT ON SEQUENCES TO svc_tenants;

-- ── YogaStudio schemas (one per microservice) ──────────────────
CREATE SCHEMA IF NOT EXISTS yoga_auth;
CREATE SCHEMA IF NOT EXISTS yoga_users;
CREATE SCHEMA IF NOT EXISTS yoga_classes;
CREATE SCHEMA IF NOT EXISTS yoga_bookings;
CREATE SCHEMA IF NOT EXISTS yoga_bonuses;
CREATE SCHEMA IF NOT EXISTS yoga_payments;
CREATE SCHEMA IF NOT EXISTS yoga_notifications;
CREATE SCHEMA IF NOT EXISTS yoga_reporting;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_auth') THEN
    CREATE ROLE svc_yoga_auth LOGIN PASSWORD 'yoga_auth_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_users') THEN
    CREATE ROLE svc_yoga_users LOGIN PASSWORD 'yoga_users_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_classes') THEN
    CREATE ROLE svc_yoga_classes LOGIN PASSWORD 'yoga_classes_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_bookings') THEN
    CREATE ROLE svc_yoga_bookings LOGIN PASSWORD 'yoga_bookings_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_bonuses') THEN
    CREATE ROLE svc_yoga_bonuses LOGIN PASSWORD 'yoga_bonuses_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_payments') THEN
    CREATE ROLE svc_yoga_payments LOGIN PASSWORD 'yoga_payments_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_notifications') THEN
    CREATE ROLE svc_yoga_notifications LOGIN PASSWORD 'yoga_notifications_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_reporting') THEN
    CREATE ROLE svc_yoga_reporting LOGIN PASSWORD 'yoga_reporting_secret';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA yoga_auth         TO svc_yoga_auth;
GRANT USAGE ON SCHEMA yoga_users        TO svc_yoga_users;
GRANT USAGE ON SCHEMA yoga_classes      TO svc_yoga_classes;
GRANT USAGE ON SCHEMA yoga_bookings     TO svc_yoga_bookings;
GRANT USAGE ON SCHEMA yoga_bonuses      TO svc_yoga_bonuses;
GRANT USAGE ON SCHEMA yoga_payments     TO svc_yoga_payments;
GRANT USAGE ON SCHEMA yoga_notifications TO svc_yoga_notifications;
GRANT USAGE ON SCHEMA yoga_reporting    TO svc_yoga_reporting;

ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_yoga_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_users
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_yoga_users;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_classes
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_yoga_classes;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_bookings
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_yoga_bookings;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_bonuses
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_yoga_bonuses;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_payments
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_yoga_payments;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_notifications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_yoga_notifications;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_reporting
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_yoga_reporting;

ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_auth
  GRANT USAGE, SELECT ON SEQUENCES TO svc_yoga_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_users
  GRANT USAGE, SELECT ON SEQUENCES TO svc_yoga_users;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_classes
  GRANT USAGE, SELECT ON SEQUENCES TO svc_yoga_classes;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_bookings
  GRANT USAGE, SELECT ON SEQUENCES TO svc_yoga_bookings;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_bonuses
  GRANT USAGE, SELECT ON SEQUENCES TO svc_yoga_bonuses;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_payments
  GRANT USAGE, SELECT ON SEQUENCES TO svc_yoga_payments;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_notifications
  GRANT USAGE, SELECT ON SEQUENCES TO svc_yoga_notifications;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_reporting
  GRANT USAGE, SELECT ON SEQUENCES TO svc_yoga_reporting;

-- ── Cron role (BYPASSRLS) for cross-tenant background jobs ─────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_yoga_cron') THEN
    CREATE ROLE svc_yoga_cron LOGIN PASSWORD 'yoga_cron_secret' BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA yoga_bookings TO svc_yoga_cron;
GRANT USAGE ON SCHEMA yoga_bonuses  TO svc_yoga_cron;

ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_bookings
  GRANT SELECT, UPDATE ON TABLES TO svc_yoga_cron;
ALTER DEFAULT PRIVILEGES IN SCHEMA yoga_bonuses
  GRANT SELECT ON TABLES TO svc_yoga_cron;
