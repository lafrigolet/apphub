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

-- ── YogaStudio schemas/roles: removed when the app was retired. ─
-- DBs ya existentes que arrancaron este script en su día pueden
-- conservar las filas yoga_* huérfanas; son inofensivas (sin tablas
-- adentro) pero pueden purgarse con DROP SCHEMA … CASCADE si se quiere.
