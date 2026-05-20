-- Seed inicial con el contenido del prototipo aulavera.html. Datos
-- idempotentes vía slug/UNIQUE; re-ejecutar no duplica filas.
--
-- Tenant fijo en V1:
--   app_id    = 'aulavera'
--   tenant_id = '70000000-0000-0000-0000-000000000001'  (Fundación AulaVera)
--
-- Forzar el GUC para que RLS deje pasar los INSERTs en este script.
SET app.app_id    = 'aulavera';
SET app.tenant_id = '70000000-0000-0000-0000-000000000001';

-- ─── events: crónica realizada (Servimayor, 7 junio) ────────────────────
INSERT INTO app_aulavera.events
  (app_id, tenant_id, kind, slug, title, when_text, area, body, quote, image_key, tags, position)
VALUES (
  'aulavera',
  '70000000-0000-0000-0000-000000000001',
  'chronicle',
  'taller-servimayor-junio-2025',
  'Taller de lectura, manualidades y grafomotricidad en Servimayor',
  'Sábado, 7 de junio · Losar de la Vera',
  'Educación',
  'Así comenzó el encuentro intergeneracional en la residencia de la tercera edad. Ante atentas miradas, gerentes, terapeutas, habitantes, socios y simpatizantes de AulaVera quedamos transportados al mundo de El Alquimista, gracias a la expresividad y pasión de Berta, la trovadora.\n\nDespués, Cris compartió una técnica para liberar bloqueos mediante la movilidad de la muñeca — con apenas 50 gramos de materiales — y Juanjo sembró cortocircuitos mentales con su explicación sobre la escritura, invitando a probar ejercicios donde no se trata de hacerlo bien, sino de sentirse bien.\n\nConcluimos con una comida conjunta, vistas al paisaje, lágrimas de emoción y un homenaje del equipo de cocina. ¡Repetiremos!',
  'La mayor mentira del mundo es que, en determinado momento de nuestra existencia, perdemos el control de nuestras vidas y éstas pasan a ser gobernadas por el destino.',
  'workshop',
  ARRAY['Intergeneracional','Lectura','Grafomotricidad','Manualidades'],
  0
)
ON CONFLICT (app_id, tenant_id, slug) DO NOTHING;

-- ─── events: workshops futuros ───────────────────────────────────────────
INSERT INTO app_aulavera.events
  (app_id, tenant_id, kind, slug, title, when_text, area, body, image_key, price_label, position)
VALUES
  ('aulavera','70000000-0000-0000-0000-000000000001','workshop','terapia-animales',
   'Terapias con animales','Próximamente · agenda abierta','Educación',
   'Las terapias con animales facilitan una mejoría en niños y adultos con discapacidades. La equinoterapia es especialmente recomendable para autismo, parálisis cerebral y síndrome Down.',
   'cow','Reservar (señal 25 €)',0),
  ('aulavera','70000000-0000-0000-0000-000000000001','workshop','ruta-caballo',
   'Ruta a caballo por la Vera','Sábados · primavera 2026','Arte y cultura',
   'Recorrido guiado por caminos rurales con un grupo reducido. Aprenderemos a relacionarnos con el caballo desde el respeto.',
   'vega','Reservar (señal 30 €)',1),
  ('aulavera','70000000-0000-0000-0000-000000000001','workshop','bio-construccion',
   'Construye una casa (bio-construcción)','Taller de 3 días','Agronomía',
   'Iniciación a la bio-construcción con materiales locales: barro, paja, madera. Manos a la obra.',
   'olives','Reservar (señal 40 €)',2),
  ('aulavera','70000000-0000-0000-0000-000000000001','workshop','pozas',
   'Excursión a las pozas','Verano 2026','Educación',
   'Caminata familiar hasta las gargantas más cercanas, baño y picnic. Apta para todas las edades.',
   'river','Reservar (señal 15 €)',3),
  ('aulavera','70000000-0000-0000-0000-000000000001','workshop','cineforum',
   'Cine fórum: paisajes y memoria','Viernes mensuales','Arte y cultura',
   'Proyección y conversación abierta. Patrimonio cultural y rural a través del cine.',
   'frog','Reservar (señal 10 €)',4)
ON CONFLICT (app_id, tenant_id, slug) DO NOTHING;

-- ─── disciplines: áreas de acción ────────────────────────────────────────
INSERT INTO app_aulavera.disciplines
  (app_id, tenant_id, slug, name, body, icon, state, position)
VALUES
  ('aulavera','70000000-0000-0000-0000-000000000001','terapia-animales',
   'Terapia con animales','Equinoterapia y otras intervenciones asistidas con animales.','🐎','En preparación',0),
  ('aulavera','70000000-0000-0000-0000-000000000001','grafomotricidad',
   'Grafomotricidad & reeducación escritural','Talleres impartidos por especialistas en escritura.','✍︎','Consolidada',1),
  ('aulavera','70000000-0000-0000-0000-000000000001','bio-construccion',
   'Bio-construcción','Aprendizaje con materiales locales y técnicas tradicionales.','⌂','En preparación',2),
  ('aulavera','70000000-0000-0000-0000-000000000001','convivencias',
   'Convivencias intergeneracionales','En colaboración con Servimayor: encuentros, lecturas, comidas conjuntas.','◐','Consolidada',3)
ON CONFLICT (app_id, tenant_id, slug) DO NOTHING;

-- ─── resources: vídeos + recursos + docs del área privada ───────────────
-- 3 vídeos + 4 recursos + 3 docs. object_id queda NULL en V1 (sin storage).
INSERT INTO app_aulavera.resources
  (app_id, tenant_id, type, title, subtitle, position, requires_membership)
VALUES
  ('aulavera','70000000-0000-0000-0000-000000000001','video','Taller de grafomotricidad — sesión 1','14:32 · 7 jun 2025',0,TRUE),
  ('aulavera','70000000-0000-0000-0000-000000000001','video','Trovador en Servimayor — El Alquimista','08:45 · 7 jun 2025',1,TRUE),
  ('aulavera','70000000-0000-0000-0000-000000000001','video','Recorrido por la finca — primavera','06:12 · 12 abr 2025',2,TRUE),

  ('aulavera','70000000-0000-0000-0000-000000000001','guide','Guía pedagógica · convivencias intergeneracionales','PDF · 24 págs.',0,TRUE),
  ('aulavera','70000000-0000-0000-0000-000000000001','guide','Plantilla de evaluación de talleres','DOCX · 4 págs.',1,TRUE),
  ('aulavera','70000000-0000-0000-0000-000000000001','guide','Pack de imágenes propias (uso interno)','ZIP · 142 MB',2,TRUE),
  ('aulavera','70000000-0000-0000-0000-000000000001','guide','Lista de poemas seleccionados','PDF · 8 págs.',3,TRUE),

  ('aulavera','70000000-0000-0000-0000-000000000001','document','Estatutos de la Fundación','Última actualización · 2025',0,TRUE),
  ('aulavera','70000000-0000-0000-0000-000000000001','document','Memoria 2024','PDF · 32 págs.',1,TRUE),
  ('aulavera','70000000-0000-0000-0000-000000000001','document','Plan estratégico 2025-2028','Documento de trabajo',2,TRUE)
ON CONFLICT (app_id, tenant_id, type, title) DO NOTHING;
