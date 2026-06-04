-- Plantilla para el módulo de leads (platform/leads).
-- Auto-respuesta al prospecto que envía el formulario público de la landing:
--   lead.acknowledged → al email del lead (acuse de recibo)
--
-- Variables disponibles (del payload del evento `lead.created`):
--   namePrefix (— " Nombre" o cadena vacía)

INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, body_html, variables) VALUES
  ('lead.acknowledged', 'email', 'es',
   'Hemos recibido tu mensaje',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Gracias por escribirnos — hemos recibido tu mensaje y te responderemos lo antes posible.' || E'\n\n' ||
     'El equipo de Hulkstein',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Gracias por escribirnos — hemos recibido tu mensaje y te responderemos lo antes posible.</p>' ||
     '<p>El equipo de Hulkstein</p>',
   ARRAY['namePrefix']
  ),
  ('lead.acknowledged', 'email', 'en',
   'We received your message',
   'Hi{{namePrefix}},' || E'\n\n' ||
     'Thanks for reaching out — we have received your message and will get back to you as soon as possible.' || E'\n\n' ||
     'The Hulkstein team',
   '<p>Hi{{namePrefix}},</p>' ||
     '<p>Thanks for reaching out — we have received your message and will get back to you as soon as possible.</p>' ||
     '<p>The Hulkstein team</p>',
   ARRAY['namePrefix']
  );
