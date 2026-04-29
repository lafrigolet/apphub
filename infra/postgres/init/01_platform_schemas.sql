-- Platform services schemas — runs after 00_init.sql (alphabetical order)

-- platform-core schemas
CREATE SCHEMA IF NOT EXISTS platform_auth;
CREATE SCHEMA IF NOT EXISTS platform_payments;
CREATE SCHEMA IF NOT EXISTS platform_notifications;
CREATE SCHEMA IF NOT EXISTS platform_catalog;
CREATE SCHEMA IF NOT EXISTS platform_tenants;

-- platform-marketplace schemas
CREATE SCHEMA IF NOT EXISTS platform_orders;
CREATE SCHEMA IF NOT EXISTS platform_inventory;
CREATE SCHEMA IF NOT EXISTS platform_reviews;
CREATE SCHEMA IF NOT EXISTS platform_messaging;
CREATE SCHEMA IF NOT EXISTS platform_shipping;
CREATE SCHEMA IF NOT EXISTS platform_disputes;

DO $$
BEGIN
  -- platform-core roles
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

  -- platform-marketplace roles
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_orders') THEN
    CREATE ROLE svc_platform_orders LOGIN PASSWORD 'platform_orders_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_inventory') THEN
    CREATE ROLE svc_platform_inventory LOGIN PASSWORD 'platform_inventory_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_reviews') THEN
    CREATE ROLE svc_platform_reviews LOGIN PASSWORD 'platform_reviews_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_messaging') THEN
    CREATE ROLE svc_platform_messaging LOGIN PASSWORD 'platform_messaging_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_shipping') THEN
    CREATE ROLE svc_platform_shipping LOGIN PASSWORD 'platform_shipping_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_disputes') THEN
    CREATE ROLE svc_platform_disputes LOGIN PASSWORD 'platform_disputes_secret';
  END IF;
END
$$;

-- USAGE grants (platform-core)
GRANT USAGE ON SCHEMA platform_auth          TO svc_platform_auth;
GRANT USAGE ON SCHEMA platform_payments      TO svc_platform_payments;
GRANT USAGE ON SCHEMA platform_notifications TO svc_platform_notifications;
GRANT USAGE ON SCHEMA platform_catalog       TO svc_platform_catalog;
GRANT USAGE ON SCHEMA platform_tenants       TO svc_platform_tenants;

-- USAGE grants (platform-marketplace)
GRANT USAGE ON SCHEMA platform_orders        TO svc_platform_orders;
GRANT USAGE ON SCHEMA platform_inventory     TO svc_platform_inventory;
GRANT USAGE ON SCHEMA platform_reviews       TO svc_platform_reviews;
GRANT USAGE ON SCHEMA platform_messaging     TO svc_platform_messaging;
GRANT USAGE ON SCHEMA platform_shipping      TO svc_platform_shipping;
GRANT USAGE ON SCHEMA platform_disputes      TO svc_platform_disputes;

-- DML default privs (platform-core)
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

-- DML default privs (platform-marketplace)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_orders
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_orders;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_inventory
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_inventory;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_reviews
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_reviews;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_messaging
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_messaging;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_shipping
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_shipping;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_disputes
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_disputes;

-- Sequence default privs (platform-core)
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

-- Sequence default privs (platform-marketplace)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_orders
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_orders;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_inventory
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_inventory;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_reviews
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_reviews;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_messaging
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_messaging;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_shipping
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_shipping;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_disputes
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_disputes;
