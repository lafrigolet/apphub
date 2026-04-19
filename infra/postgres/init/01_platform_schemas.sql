-- Platform services schemas — runs after 00_init.sql (alphabetical order)

CREATE SCHEMA IF NOT EXISTS platform_auth;
CREATE SCHEMA IF NOT EXISTS platform_payments;
CREATE SCHEMA IF NOT EXISTS platform_notifications;
CREATE SCHEMA IF NOT EXISTS platform_catalog;
CREATE SCHEMA IF NOT EXISTS platform_tenants;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_auth') THEN
    CREATE ROLE svc_platform_auth LOGIN PASSWORD 'platform_auth_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_payments') THEN
    CREATE ROLE svc_platform_payments LOGIN PASSWORD 'platform_payments_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_notifications') THEN
    CREATE ROLE svc_platform_notifications LOGIN PASSWORD 'platform_notifications_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_catalog') THEN
    CREATE ROLE svc_platform_catalog LOGIN PASSWORD 'platform_catalog_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_tenants') THEN
    CREATE ROLE svc_platform_tenants LOGIN PASSWORD 'platform_tenants_secret';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA platform_auth          TO svc_platform_auth;
GRANT USAGE ON SCHEMA platform_payments      TO svc_platform_payments;
GRANT USAGE ON SCHEMA platform_notifications TO svc_platform_notifications;
GRANT USAGE ON SCHEMA platform_catalog       TO svc_platform_catalog;
GRANT USAGE ON SCHEMA platform_tenants       TO svc_platform_tenants;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform_auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_payments
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_payments;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_notifications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_notifications;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_catalog
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_catalog;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_tenants
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_tenants;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform_auth
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_payments
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_payments;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_notifications
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_notifications;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_catalog
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_catalog;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_tenants
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_tenants;
