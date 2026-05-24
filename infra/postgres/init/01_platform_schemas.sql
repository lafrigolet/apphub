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

-- platform-restaurant schemas
CREATE SCHEMA IF NOT EXISTS platform_menu;
CREATE SCHEMA IF NOT EXISTS platform_reservations;
CREATE SCHEMA IF NOT EXISTS platform_floor_plan;
CREATE SCHEMA IF NOT EXISTS platform_kds;
CREATE SCHEMA IF NOT EXISTS platform_pos;
CREATE SCHEMA IF NOT EXISTS platform_delivery_dispatch;

-- platform-appointments schemas
CREATE SCHEMA IF NOT EXISTS platform_services;
CREATE SCHEMA IF NOT EXISTS platform_resources;
CREATE SCHEMA IF NOT EXISTS platform_bookings;
CREATE SCHEMA IF NOT EXISTS platform_availability;
CREATE SCHEMA IF NOT EXISTS platform_intake_forms;
CREATE SCHEMA IF NOT EXISTS platform_telehealth;
CREATE SCHEMA IF NOT EXISTS platform_packages;
CREATE SCHEMA IF NOT EXISTS platform_practitioner_payouts;

-- platform-scheduler schema
CREATE SCHEMA IF NOT EXISTS platform_scheduler;

-- platform-core storage module schema
CREATE SCHEMA IF NOT EXISTS platform_storage;

-- platform-core leads module schema
CREATE SCHEMA IF NOT EXISTS platform_leads;

-- platform-core donations module schema
CREATE SCHEMA IF NOT EXISTS platform_donations;

-- platform-core inquiries module schema (per-tenant contact form)
CREATE SCHEMA IF NOT EXISTS platform_inquiries;

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

  -- platform-restaurant roles
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_menu') THEN
    CREATE ROLE svc_platform_menu LOGIN PASSWORD 'platform_menu_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_reservations') THEN
    CREATE ROLE svc_platform_reservations LOGIN PASSWORD 'platform_reservations_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_floor_plan') THEN
    CREATE ROLE svc_platform_floor_plan LOGIN PASSWORD 'platform_floor_plan_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_kds') THEN
    CREATE ROLE svc_platform_kds LOGIN PASSWORD 'platform_kds_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_pos') THEN
    CREATE ROLE svc_platform_pos LOGIN PASSWORD 'platform_pos_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_delivery_dispatch') THEN
    CREATE ROLE svc_platform_delivery_dispatch LOGIN PASSWORD 'platform_delivery_dispatch_secret';
  END IF;

  -- platform-appointments roles
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_services') THEN
    CREATE ROLE svc_platform_services LOGIN PASSWORD 'platform_services_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_resources') THEN
    CREATE ROLE svc_platform_resources LOGIN PASSWORD 'platform_resources_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_bookings') THEN
    CREATE ROLE svc_platform_bookings LOGIN PASSWORD 'platform_bookings_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_availability') THEN
    CREATE ROLE svc_platform_availability LOGIN PASSWORD 'platform_availability_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_intake_forms') THEN
    CREATE ROLE svc_platform_intake_forms LOGIN PASSWORD 'platform_intake_forms_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_telehealth') THEN
    CREATE ROLE svc_platform_telehealth LOGIN PASSWORD 'platform_telehealth_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_packages') THEN
    CREATE ROLE svc_platform_packages LOGIN PASSWORD 'platform_packages_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_practitioner_payouts') THEN
    CREATE ROLE svc_platform_practitioner_payouts LOGIN PASSWORD 'platform_practitioner_payouts_secret';
  END IF;

  -- platform-scheduler role
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_scheduler') THEN
    CREATE ROLE svc_platform_scheduler LOGIN PASSWORD 'platform_scheduler_secret';
  END IF;

  -- platform-core storage module role
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_storage') THEN
    CREATE ROLE svc_platform_storage LOGIN PASSWORD 'platform_storage_secret';
  END IF;

  -- platform-core leads module role
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_leads') THEN
    CREATE ROLE svc_platform_leads LOGIN PASSWORD 'platform_leads_secret';
  END IF;

  -- platform-core donations module role
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_donations') THEN
    CREATE ROLE svc_platform_donations LOGIN PASSWORD 'platform_donations_secret';
  END IF;

  -- platform-core inquiries module role
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_platform_inquiries') THEN
    CREATE ROLE svc_platform_inquiries LOGIN PASSWORD 'platform_inquiries_secret';
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

-- USAGE grants (platform-restaurant)
GRANT USAGE ON SCHEMA platform_menu               TO svc_platform_menu;
GRANT USAGE ON SCHEMA platform_reservations       TO svc_platform_reservations;
GRANT USAGE ON SCHEMA platform_floor_plan         TO svc_platform_floor_plan;
GRANT USAGE ON SCHEMA platform_kds                TO svc_platform_kds;
GRANT USAGE ON SCHEMA platform_pos                TO svc_platform_pos;
GRANT USAGE ON SCHEMA platform_delivery_dispatch  TO svc_platform_delivery_dispatch;

-- USAGE grants (platform-appointments)
GRANT USAGE ON SCHEMA platform_services             TO svc_platform_services;
GRANT USAGE ON SCHEMA platform_resources            TO svc_platform_resources;
GRANT USAGE ON SCHEMA platform_bookings             TO svc_platform_bookings;
GRANT USAGE ON SCHEMA platform_availability         TO svc_platform_availability;
GRANT USAGE ON SCHEMA platform_intake_forms         TO svc_platform_intake_forms;
GRANT USAGE ON SCHEMA platform_telehealth           TO svc_platform_telehealth;
GRANT USAGE ON SCHEMA platform_packages             TO svc_platform_packages;
GRANT USAGE ON SCHEMA platform_practitioner_payouts TO svc_platform_practitioner_payouts;

-- USAGE grants (platform-scheduler)
GRANT USAGE ON SCHEMA platform_scheduler            TO svc_platform_scheduler;

-- USAGE grants (platform-core storage module)
GRANT USAGE ON SCHEMA platform_storage              TO svc_platform_storage;

-- USAGE grants (platform-core leads module)
GRANT USAGE ON SCHEMA platform_leads                TO svc_platform_leads;

-- USAGE grants (platform-core inquiries module)
GRANT USAGE ON SCHEMA platform_inquiries            TO svc_platform_inquiries;

-- USAGE grants (platform-core donations module)
GRANT USAGE ON SCHEMA platform_donations            TO svc_platform_donations;
-- El módulo donations necesita leer info del declarante para emitir
-- certificados y modelo 182 → pequeño boundary leak sólo sobre
-- columnas no-secretas de tenants. Patrón ya usado en auth para la
-- flag requires_user_approval.
GRANT USAGE ON SCHEMA platform_tenants              TO svc_platform_donations;
-- La tabla platform_tenants.tenants la crea la migration 0001 de tenant-config,
-- que corre después de los init scripts (vía platform-core boot). En una
-- inicialización fresca de Postgres este GRANT se aplica antes de que la
-- tabla exista; lo envolvemos en un DO block tolerante para no crashear el
-- entrypoint. La migration de tenant-config 0001 re-emite el GRANT cuando
-- la tabla ya existe, así el estado final es idempotente y correcto.
DO $$
BEGIN
  GRANT SELECT (id, app_id, legal_name, display_name, cif, address)
    ON platform_tenants.tenants TO svc_platform_donations;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'platform_tenants.tenants does not exist yet; tenant-config migration will re-apply this GRANT';
END $$;

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

-- DML default privs (platform-restaurant)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_menu
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_menu;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_reservations
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_reservations;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_floor_plan
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_floor_plan;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_kds
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_kds;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_pos
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_pos;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_delivery_dispatch
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_delivery_dispatch;

-- DML default privs (platform-appointments)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_services
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_services;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_resources
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_resources;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_bookings
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_bookings;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_availability
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_availability;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_intake_forms
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_intake_forms;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_telehealth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_telehealth;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_packages
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_packages;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_practitioner_payouts
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_practitioner_payouts;

-- DML default privs (platform-scheduler)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_scheduler
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_scheduler;

-- DML default privs (platform-core storage)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_storage
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_storage;

-- DML default privs (platform-core leads)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_leads
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_leads;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_leads
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_leads;

-- DML default privs (platform-core donations)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_donations
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_donations;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_donations
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_donations;

-- DML default privs (platform-core inquiries)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_inquiries
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_platform_inquiries;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_inquiries
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_inquiries;

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

-- Sequence default privs (platform-restaurant)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_menu
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_menu;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_reservations
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_reservations;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_floor_plan
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_floor_plan;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_kds
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_kds;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_pos
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_pos;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_delivery_dispatch
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_delivery_dispatch;

-- Sequence default privs (platform-appointments)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_services
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_services;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_resources
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_resources;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_bookings
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_bookings;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_availability
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_availability;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_intake_forms
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_intake_forms;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_telehealth
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_telehealth;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_packages
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_packages;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_practitioner_payouts
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_practitioner_payouts;

-- Sequence default privs (platform-scheduler)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_scheduler
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_scheduler;

-- Sequence default privs (platform-core storage)
ALTER DEFAULT PRIVILEGES IN SCHEMA platform_storage
  GRANT USAGE, SELECT ON SEQUENCES TO svc_platform_storage;
