-- Fase 3: añade los módulos nuevos (basket, bookings, availability, orders,
-- inventory, reviews, intake-forms, practitioner-payouts, telehealth,
-- disputes, catalog, shipping, messaging, packages, services) al
-- enabled_modules de cada app según su perfil.
--
-- - yoga-studio + aikikan (appointments-flavored): mantienen su set y nada
--   nuevo (las apps appointments ya tenían bookings/availability/etc en 0006).
-- - split-pay (marketplace-flavored): se le suma el set marketplace
--   completo (inventory, reviews, basket, catalog, shipping, messaging).
-- - voragine-console: sin cambios — staff console usa otra UI.
--
-- Idempotente vía DISTINCT.

UPDATE platform_tenants.apps
   SET enabled_modules = ARRAY(
         SELECT DISTINCT unnest(enabled_modules || ARRAY[
           'orders','inventory','reviews','basket','catalog','shipping','messaging','disputes'
         ])
       )
 WHERE app_id = 'split-pay';
