-- Plantillas del flujo Self-register + Admin-approval (Ruta 1).
--
-- Tres eventos del lado de auth:
--   auth.signup.requested  → email "Solicitud recibida"
--   auth.signup.approved   → email "Cuenta aprobada" con magic-link
--   auth.signup.rejected   → email "Solicitud no aprobada" con reason opcional
--
-- En todos los casos el destinatario es el solicitante (no admin).
-- El subscriber en event-consumer.js mapea cada evento a su plantilla.

INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, body_html, variables) VALUES
  ('auth.signup.requested', 'email', 'es',
   'Hemos recibido tu solicitud',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Hemos recibido tu solicitud de alta. Un administrador la revisará y te ' ||
     'avisaremos por email en cuanto la decisión esté tomada.' || E'\n\n' ||
     'Gracias por tu interés.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Hemos recibido tu solicitud de alta. Un administrador la revisará y te ' ||
     'avisaremos por email en cuanto la decisión esté tomada.</p>' ||
     '<p>Gracias por tu interés.</p>',
   ARRAY['namePrefix']
  ),
  ('auth.signup.approved', 'email', 'es',
   'Tu cuenta ha sido aprobada — fija tu contraseña',
   'Hola{{namePrefix}},' || E'\n\n' ||
     '¡Buenas noticias! Tu solicitud ha sido aprobada. Para activar tu cuenta, ' ||
     'pulsa el siguiente enlace y fija tu contraseña (válido durante 1 hora):' || E'\n\n' ||
     '{{magicLinkUrl}}' || E'\n\n' ||
     'Si te has registrado con Google o Facebook, puedes ignorar este enlace y ' ||
     'simplemente volver a iniciar sesión con ese proveedor.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>¡Buenas noticias! Tu solicitud ha sido aprobada. Para activar tu cuenta, ' ||
     'pulsa el siguiente enlace y fija tu contraseña (válido durante 1 hora):</p>' ||
     '<p><a href="{{magicLinkUrl}}">{{magicLinkUrl}}</a></p>' ||
     '<p>Si te has registrado con Google o Facebook, puedes ignorar este enlace y ' ||
     'simplemente volver a iniciar sesión con ese proveedor.</p>',
   ARRAY['namePrefix','magicLinkUrl']
  ),
  ('auth.signup.rejected', 'email', 'es',
   'Tu solicitud no ha sido aprobada',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Lamentamos comunicarte que tu solicitud de alta no ha sido aprobada.{{reasonBlock}}' || E'\n\n' ||
     'Si crees que se trata de un error o quieres volver a solicitarlo más adelante, ' ||
     'contacta con el equipo.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Lamentamos comunicarte que tu solicitud de alta no ha sido aprobada.{{reasonBlock}}</p>' ||
     '<p>Si crees que se trata de un error o quieres volver a solicitarlo más adelante, ' ||
     'contacta con el equipo.</p>',
   ARRAY['namePrefix','reasonBlock']
  )
ON CONFLICT (key, channel, locale) DO NOTHING;
