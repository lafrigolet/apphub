-- Per-tenant IANA timezone (e.g. 'Europe/Madrid'). Used by platform-scheduler
-- reminder jobs and availability slot computation to render times in the
-- tenant's local time instead of UTC. Free text (no enum) so adding/adjusting
-- a zone is a pure data change; consumers fall back to 'UTC' when the value is
-- unrecognised, so an invalid string only degrades to UTC — never blocks.
--
-- Default 'UTC' keeps existing behaviour for every current tenant. Spanish
-- tenants are nudged to Europe/Madrid; staff can override per tenant via
-- PATCH /v1/tenants/:id.
ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

UPDATE platform_tenants.tenants
   SET timezone = 'Europe/Madrid'
 WHERE country IN ('ES', 'España', 'Spain')
   AND timezone = 'UTC';
