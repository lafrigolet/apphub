-- Dev seed for the luciapassardi backoffice. Idempotente, dev-only.
--
-- Aprovisiona el app+tenant y siembra el dominio REUTILIZANDO módulos de
-- plataforma (services, resources, availability/bookings, packages). Las
-- "ubicaciones" se modelan como resources (kind=room) — una sola profesora.
--
-- Run (repo root, stack up):
--   docker compose exec -T postgres psql -U splitpay -d splitpay -f - < apps/luciapassardi/seed.sql
--
-- Crea:
--   - app    : luciapassardi
--   - tenant : Lucía Passardi      (id 70000000-…-0001)
--   - owner  : lucia@luciapassardi.local / lucia1234  (rol owner)
--   - clases : services (Hatha, Vinyasa, Ashtanga, Yin, Yoga suave, Pranayama, Clase suelta, Eventos)
--   - salas  : resources (Estudio Las Matas, Centro El Pinar, Online)
--   - bonos  : package_templates (Bono 5, Bono 10)
--   - horario: service_sessions de las clases (próximas 3 semanas) + eventos
--
-- password_hash = bcrypt(cost 12) de 'lucia1234' (dev, comprometido a propósito).

BEGIN;

-- ── 1. App + tenant + owner ──────────────────────────────────────────
INSERT INTO platform_tenants.apps (app_id, display_name, subdomain, jwt_audience, enabled_modules)
VALUES ('luciapassardi', 'Lucía Passardi', 'luciapassardi', 'luciapassardi',
        ARRAY['tenants','auth','notifications','payments','storage','services','resources','availability','bookings','packages','commerce'])
ON CONFLICT (app_id) DO UPDATE SET display_name = EXCLUDED.display_name, enabled_modules = EXCLUDED.enabled_modules;

INSERT INTO platform_tenants.tenants (id, app_id, display_name, subdomain, status, country, plan, contact_email, default_locale)
VALUES ('70000000-0000-0000-0000-000000000001', 'luciapassardi', 'Lucía Passardi', 'luciapassardi',
        'active', 'ES', 'STARTER', 'lucyapassardi@gmail.com', 'es')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = EXCLUDED.status;

INSERT INTO platform_auth.users (id, app_id, tenant_id, email, password_hash, role, display_name)
VALUES ('70000001-0000-0000-0000-000000000001', 'luciapassardi', '70000000-0000-0000-0000-000000000001',
        'lucia@luciapassardi.local', '$2b$12$tNGvVUeTB5vMzyaOVSp8auUSpuISLmmJYkrUQHyb5B5IgddRKIs/m',
        'owner', 'Lucía Passardi')
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, revoked_at = NULL;

-- ── 2. Clases (services) ─────────────────────────────────────────────
INSERT INTO platform_services.services
  (id, app_id, tenant_id, code, name, duration_minutes, capacity, price_cents, modality, kind, public_catalog)
VALUES
  ('70000002-0000-0000-0000-000000000001','luciapassardi','70000000-0000-0000-0000-000000000001','hatha','Hatha',75,12,1500,'in_person','appointment',true),
  ('70000002-0000-0000-0000-000000000002','luciapassardi','70000000-0000-0000-0000-000000000001','vinyasa','Vinyasa',75,12,1500,'in_person','appointment',true),
  ('70000002-0000-0000-0000-000000000003','luciapassardi','70000000-0000-0000-0000-000000000001','ashtanga','Ashtanga',90,12,1700,'in_person','appointment',true),
  ('70000002-0000-0000-0000-000000000004','luciapassardi','70000000-0000-0000-0000-000000000001','yin','Yin y restaurativo',60,14,1500,'hybrid','appointment',true),
  ('70000002-0000-0000-0000-000000000005','luciapassardi','70000000-0000-0000-0000-000000000001','suave','Yoga suave',60,12,1400,'in_person','appointment',true),
  ('70000002-0000-0000-0000-000000000006','luciapassardi','70000000-0000-0000-0000-000000000001','pranayama','Pranayama y meditación',60,16,1200,'in_person','appointment',true),
  ('70000002-0000-0000-0000-000000000007','luciapassardi','70000000-0000-0000-0000-000000000001','clase','Clase suelta',75,12,1500,'in_person','appointment',false),
  ('70000002-0000-0000-0000-000000000008','luciapassardi','70000000-0000-0000-0000-000000000001','eventos','Eventos y retiros',60,30,0,'in_person','event',true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, capacity = EXCLUDED.capacity, price_cents = EXCLUDED.price_cents, public_catalog = EXCLUDED.public_catalog;

-- ── 3. Ubicaciones (resources kind=room) ─────────────────────────────
INSERT INTO platform_resources.resources (id, app_id, tenant_id, kind, display_name, capacity, timezone)
VALUES
  ('70000003-0000-0000-0000-000000000001','luciapassardi','70000000-0000-0000-0000-000000000001','room','Estudio Las Matas',12,'Europe/Madrid'),
  ('70000003-0000-0000-0000-000000000002','luciapassardi','70000000-0000-0000-0000-000000000001','room','Centro El Pinar',12,'Europe/Madrid'),
  ('70000003-0000-0000-0000-000000000003','luciapassardi','70000000-0000-0000-0000-000000000001','room','Online (Zoom)',20,'Europe/Madrid')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, capacity = EXCLUDED.capacity;

-- ── 4. Bonos (package_templates) ─────────────────────────────────────
INSERT INTO platform_packages.package_templates (id, app_id, tenant_id, code, name, service_id, total_sessions, validity_days, price_cents)
VALUES
  ('70000004-0000-0000-0000-000000000001','luciapassardi','70000000-0000-0000-0000-000000000001','bono5','Bono 5 clases','70000002-0000-0000-0000-000000000007',5,60,6000),
  ('70000004-0000-0000-0000-000000000002','luciapassardi','70000000-0000-0000-0000-000000000001','bono10','Bono 10 clases','70000002-0000-0000-0000-000000000007',10,90,11000)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, total_sessions = EXCLUDED.total_sessions, price_cents = EXCLUDED.price_cents;

-- ── 5. Horario semanal → service_sessions de las próximas 3 semanas ───
-- Re-seed limpio: borra las sesiones sembradas previas del tenant.
DELETE FROM platform_services.service_sessions
 WHERE app_id = 'luciapassardi' AND tenant_id = '70000000-0000-0000-0000-000000000001'
   AND metadata->>'seed' = '1';

INSERT INTO platform_services.service_sessions
  (app_id, tenant_id, service_id, resource_id, starts_at, ends_at, capacity, location, status, description, metadata)
SELECT
  'luciapassardi', '70000000-0000-0000-0000-000000000001',
  g.service_id::uuid, g.resource_id::uuid,
  ((d::date + g.hhmm)::timestamp AT TIME ZONE 'Europe/Madrid') AS starts_at,
  ((d::date + g.hhmm)::timestamp AT TIME ZONE 'Europe/Madrid') + (g.dur || ' minutes')::interval AS ends_at,
  g.capacity, g.location, 'scheduled', g.label, '{"seed":"1"}'::jsonb
FROM generate_series(current_date, current_date + INTERVAL '20 days', INTERVAL '1 day') AS d
CROSS JOIN (VALUES
  -- service_id, resource_id, isodow, hh:mm, duración, aforo, ubicación, etiqueta
  ('70000002-0000-0000-0000-000000000001','70000003-0000-0000-0000-000000000001',1,'09:30'::time,75,12,'Estudio Las Matas','Hatha'),
  ('70000002-0000-0000-0000-000000000002','70000003-0000-0000-0000-000000000001',1,'18:30'::time,75,12,'Estudio Las Matas','Vinyasa'),
  ('70000002-0000-0000-0000-000000000005','70000003-0000-0000-0000-000000000002',2,'10:00'::time,60,12,'Centro El Pinar','Yoga suave'),
  ('70000002-0000-0000-0000-000000000003','70000003-0000-0000-0000-000000000001',2,'19:00'::time,90,12,'Estudio Las Matas','Ashtanga'),
  ('70000002-0000-0000-0000-000000000001','70000003-0000-0000-0000-000000000001',3,'09:30'::time,75,12,'Estudio Las Matas','Hatha'),
  ('70000002-0000-0000-0000-000000000004','70000003-0000-0000-0000-000000000003',3,'18:00'::time,60,20,'Online (Zoom)','Yin y restaurativo'),
  ('70000002-0000-0000-0000-000000000002','70000003-0000-0000-0000-000000000002',4,'10:00'::time,75,12,'Centro El Pinar','Vinyasa'),
  ('70000002-0000-0000-0000-000000000006','70000003-0000-0000-0000-000000000001',4,'19:00'::time,60,16,'Estudio Las Matas','Pranayama y meditación'),
  ('70000002-0000-0000-0000-000000000001','70000003-0000-0000-0000-000000000001',5,'09:30'::time,75,12,'Estudio Las Matas','Hatha'),
  ('70000002-0000-0000-0000-000000000003','70000003-0000-0000-0000-000000000001',5,'18:30'::time,90,12,'Estudio Las Matas','Práctica colectiva'),
  ('70000002-0000-0000-0000-000000000002','70000003-0000-0000-0000-000000000001',6,'10:00'::time,90,12,'Estudio Las Matas','Vinyasa'),
  ('70000002-0000-0000-0000-000000000005','70000003-0000-0000-0000-000000000003',7,'10:30'::time,60,20,'Online (Zoom)','Yoga suave y meditación')
) AS g(service_id, resource_id, isodow, hhmm, dur, capacity, location, label)
WHERE EXTRACT(ISODOW FROM d) = g.isodow
  AND (d::date + g.hhmm) > now();

-- ── 6. Eventos / retiros / talleres (service 'eventos', kind=event) ───
DELETE FROM platform_services.service_sessions
 WHERE app_id = 'luciapassardi' AND tenant_id = '70000000-0000-0000-0000-000000000001'
   AND service_id = '70000002-0000-0000-0000-000000000008' AND metadata->>'seed' = 'event';

INSERT INTO platform_services.service_sessions
  (app_id, tenant_id, service_id, starts_at, ends_at, capacity, location, status, description, metadata)
VALUES
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000002-0000-0000-0000-000000000008',
   '2026-07-12T09:00:00+02:00','2026-07-12T11:00:00+02:00',20,'Parque de Las Matas','scheduled','Yoga al aire libre','{"seed":"event"}'::jsonb),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000002-0000-0000-0000-000000000008',
   '2026-09-27T10:00:00+02:00','2026-09-27T13:00:00+02:00',12,'Estudio Las Matas','scheduled','Taller de abdomen y suelo pélvico','{"seed":"event"}'::jsonb),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000002-0000-0000-0000-000000000008',
   '2027-01-10T17:00:00+01:00','2027-01-12T13:00:00+01:00',14,'Sierra de Madrid','scheduled','Retiro de enero','{"seed":"event"}'::jsonb);

-- ── 7. Productos del marketplace (platform_catalog.items) ────────────
-- Mismos productos que la tienda de la web, ahora como datos reales del catálogo.
INSERT INTO platform_catalog.items
  (id, app_id, tenant_id, name, description, price_cents, currency, category, item_type, status, active, slug)
VALUES
  ('70000005-0000-0000-0000-000000000001','luciapassardi','70000000-0000-0000-0000-000000000001','Esterilla Sattva (caucho natural)','Agarre y amortiguación, 4,5 mm.',6900,'EUR','Esterillas','physical','published',true,'esterilla-sattva'),
  ('70000005-0000-0000-0000-000000000002','luciapassardi','70000000-0000-0000-0000-000000000001','Esterilla de viaje plegable','Ligera, 1,5 mm, cabe en la mochila.',4500,'EUR','Esterillas','physical','published',true,'esterilla-viaje'),
  ('70000005-0000-0000-0000-000000000003','luciapassardi','70000000-0000-0000-0000-000000000001','Esterilla algodón tejida','Tradicional, ideal para Ashtanga.',3900,'EUR','Esterillas','physical','published',true,'esterilla-algodon'),
  ('70000005-0000-0000-0000-000000000004','luciapassardi','70000000-0000-0000-0000-000000000001','Par de bloques de corcho','Estables y naturales.',2200,'EUR','Props','physical','published',true,'bloques-corcho'),
  ('70000005-0000-0000-0000-000000000005','luciapassardi','70000000-0000-0000-0000-000000000001','Cinturón de algodón','Hebilla metálica, 2,5 m.',1200,'EUR','Props','physical','published',true,'cinturon-algodon'),
  ('70000005-0000-0000-0000-000000000006','luciapassardi','70000000-0000-0000-0000-000000000001','Bolster de meditación','Relleno firme, funda lavable.',4900,'EUR','Props','physical','published',true,'bolster-meditacion'),
  ('70000005-0000-0000-0000-000000000007','luciapassardi','70000000-0000-0000-0000-000000000001','Manta de yoga','Para relajación y soporte.',3500,'EUR','Props','physical','published',true,'manta-yoga'),
  ('70000005-0000-0000-0000-000000000008','luciapassardi','70000000-0000-0000-0000-000000000001','Leggings Respira','Cintura alta, tejido técnico.',3900,'EUR','Ropa','physical','published',true,'leggings-respira'),
  ('70000005-0000-0000-0000-000000000009','luciapassardi','70000000-0000-0000-0000-000000000001','Top sujeción media','Suave, sin costuras.',2900,'EUR','Ropa','physical','published',true,'top-sujecion-media'),
  ('70000005-0000-0000-0000-000000000010','luciapassardi','70000000-0000-0000-0000-000000000001','Sudadera Respira y avanza','Algodón orgánico.',4500,'EUR','Ropa','physical','published',true,'sudadera-respira'),
  ('70000005-0000-0000-0000-000000000011','luciapassardi','70000000-0000-0000-0000-000000000001','Incienso natural (pack 3)','Lavanda, sándalo y palo santo.',900,'EUR','Bienestar','physical','published',true,'incienso-natural'),
  ('70000005-0000-0000-0000-000000000012','luciapassardi','70000000-0000-0000-0000-000000000001','Aceite esencial de lavanda','Para relajación y descanso.',1400,'EUR','Bienestar','physical','published',true,'aceite-lavanda'),
  ('70000005-0000-0000-0000-000000000013','luciapassardi','70000000-0000-0000-0000-000000000001','Mala de 108 cuentas','Semillas de rudraksha.',2500,'EUR','Bienestar','physical','published',true,'mala-108'),
  ('70000005-0000-0000-0000-000000000014','luciapassardi','70000000-0000-0000-0000-000000000001','Cojín de ojos (lavanda)','Para savasana y meditación.',1800,'EUR','Bienestar','physical','published',true,'cojin-ojos'),
  ('70000005-0000-0000-0000-000000000015','luciapassardi','70000000-0000-0000-0000-000000000001','Bono 5 clases','Caduca a los 2 meses.',6000,'EUR','Bonos','service','published',true,'bono-5'),
  ('70000005-0000-0000-0000-000000000016','luciapassardi','70000000-0000-0000-0000-000000000001','Bono 10 clases','El mejor precio por clase.',11000,'EUR','Bonos','service','published',true,'bono-10'),
  ('70000005-0000-0000-0000-000000000017','luciapassardi','70000000-0000-0000-0000-000000000001','Tarjeta regalo','Regala práctica. Importe a elegir.',2500,'EUR','Bonos','service','published',true,'tarjeta-regalo')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, price_cents = EXCLUDED.price_cents,
  category = EXCLUDED.category, item_type = EXCLUDED.item_type, status = EXCLUDED.status, active = EXCLUDED.active;

-- ── 8. Pedidos del marketplace (platform_orders) ─────────────────────
-- Pedidos reales que las practicantes han hecho en la tienda. El backoffice
-- los lista y permite avanzar su estado (FSM pending→paid→…→completed).
-- buyer_user_id no tiene FK; el nombre/email del comprador va en metadata.
DELETE FROM platform_orders.orders
 WHERE app_id = 'luciapassardi' AND tenant_id = '70000000-0000-0000-0000-000000000001'
   AND id::text LIKE '70000006-%';

INSERT INTO platform_orders.orders
  (id, app_id, tenant_id, buyer_user_id, status, currency,
   subtotal_cents, tax_cents, shipping_cents, total_cents, metadata, created_at, updated_at)
VALUES
  ('70000006-0000-0000-0000-000000000001','luciapassardi','70000000-0000-0000-0000-000000000001','70000007-0000-0000-0000-000000000001','paid','EUR',
   9100,0,500,9600,'{"buyerName":"Marta Ruiz","buyerEmail":"marta.ruiz@example.com"}'::jsonb, now() - interval '2 days', now() - interval '2 days'),
  ('70000006-0000-0000-0000-000000000002','luciapassardi','70000000-0000-0000-0000-000000000001','70000007-0000-0000-0000-000000000002','fulfilled','EUR',
   6800,0,500,7300,'{"buyerName":"Carlos Vidal","buyerEmail":"carlos.vidal@example.com"}'::jsonb, now() - interval '5 days', now() - interval '4 days'),
  ('70000006-0000-0000-0000-000000000003','luciapassardi','70000000-0000-0000-0000-000000000001','70000007-0000-0000-0000-000000000003','shipped','EUR',
   11000,0,0,11000,'{"buyerName":"Ana Soler","buyerEmail":"ana.soler@example.com"}'::jsonb, now() - interval '8 days', now() - interval '6 days'),
  ('70000006-0000-0000-0000-000000000004','luciapassardi','70000000-0000-0000-0000-000000000001','70000007-0000-0000-0000-000000000004','delivered','EUR',
   8400,0,500,8900,'{"buyerName":"Lucía Romero","buyerEmail":"lucia.romero@example.com"}'::jsonb, now() - interval '14 days', now() - interval '10 days'),
  ('70000006-0000-0000-0000-000000000005','luciapassardi','70000000-0000-0000-0000-000000000001','70000007-0000-0000-0000-000000000005','completed','EUR',
   4800,0,500,5300,'{"buyerName":"Sofía Marín","buyerEmail":"sofia.marin@example.com"}'::jsonb, now() - interval '21 days', now() - interval '15 days'),
  ('70000006-0000-0000-0000-000000000006','luciapassardi','70000000-0000-0000-0000-000000000001','70000007-0000-0000-0000-000000000006','cancelled','EUR',
   4500,0,500,5000,'{"buyerName":"Diego Pérez","buyerEmail":"diego.perez@example.com"}'::jsonb, now() - interval '3 days', now() - interval '3 days');

INSERT INTO platform_orders.order_items
  (app_id, tenant_id, order_id, sku, product_name, qty, unit_price_cents)
VALUES
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000001','esterilla-sattva','Esterilla Sattva (caucho natural)',1,6900),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000001','bloques-corcho','Par de bloques de corcho',1,2200),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000002','leggings-respira','Leggings Respira',1,3900),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000002','top-sujecion-media','Top sujeción media',1,2900),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000003','bono-10','Bono 10 clases',1,11000),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000004','bolster-meditacion','Bolster de meditación',1,4900),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000004','manta-yoga','Manta de yoga',1,3500),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000005','incienso-natural','Incienso natural (pack 3)',1,900),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000005','aceite-lavanda','Aceite esencial de lavanda',1,1400),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000005','mala-108','Mala de 108 cuentas',1,2500),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000006','sudadera-respira','Sudadera Respira y avanza',1,4500);

INSERT INTO platform_orders.order_addresses
  (app_id, tenant_id, order_id, kind, full_name, line1, city, region, postal_code, country, phone)
VALUES
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000001','shipping','Marta Ruiz','C/ del Sol 12','Las Rozas','Madrid','28232','ES','+34600111222'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000002','shipping','Carlos Vidal','Av. de Europa 8','Las Matas','Madrid','28290','ES','+34600333444'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000004','shipping','Lucía Romero','C/ Mayor 3','Torrelodones','Madrid','28250','ES','+34600555666'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000005','shipping','Sofía Marín','C/ Real 45','Galapagar','Madrid','28260','ES','+34600777888'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000006','shipping','Diego Pérez','C/ Nueva 7','Las Matas','Madrid','28290','ES','+34600999000');

INSERT INTO platform_orders.order_status_history
  (app_id, tenant_id, order_id, from_status, to_status, actor_role, reason, ts)
VALUES
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000001',NULL,'pending','system','order created', now() - interval '2 days'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000001','pending','paid','system','payment completed', now() - interval '2 days'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000002','pending','paid','system','payment completed', now() - interval '5 days'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000002','paid','fulfilled','owner','preparado para envío', now() - interval '4 days'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000003','pending','paid','system','payment completed', now() - interval '8 days'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000003','paid','shipped','owner','enviado por mensajería', now() - interval '6 days'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000004','paid','delivered','owner','entregado', now() - interval '10 days'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000005','delivered','completed','owner','pedido completado', now() - interval '15 days'),
  ('luciapassardi','70000000-0000-0000-0000-000000000001','70000006-0000-0000-0000-000000000006','pending','cancelled','owner','cancelado a petición de la clienta', now() - interval '3 days');

-- ── 9. Suscripción del tenant a la plataforma (hulkstein) ────────────
-- Plan comercial: 100 €/mes, pago con tarjeta. El owner la activa/desactiva
-- desde el backoffice (Stripe Checkout, mode=subscription). El staff configura
-- el subscription_stripe_price_id real para que el cobro se ejecute.
UPDATE platform_tenants.tenants SET
  subscription_period         = 'monthly',
  subscription_amount_cents   = 10000,
  subscription_currency       = 'eur',
  subscription_payment_method = 'card',
  subscription_billing_email  = 'lucia@luciapassardi.local'
WHERE id = '70000000-0000-0000-0000-000000000001' AND app_id = 'luciapassardi';

COMMIT;
