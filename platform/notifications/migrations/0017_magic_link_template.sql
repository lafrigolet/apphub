-- Plantilla del flujo magic-link passwordless (A8).
-- El subscriber en event-consumer.js mapea `auth.magic_link_requested`
-- → este template y compone la URL https://<subdomain>.<domain>/magic-login?token=<plain>.

INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, body_html, variables) VALUES
  ('auth.magic_link_requested', 'email', 'es',
   'Tu enlace de acceso',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Has solicitado un enlace de acceso sin contraseña. Pulsa aquí para entrar ' ||
     '(válido durante 15 minutos):' || E'\n\n' ||
     '{{magicLinkUrl}}' || E'\n\n' ||
     'Si no has sido tú, ignora este email — nadie ha entrado en tu cuenta.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Has solicitado un enlace de acceso sin contraseña. Pulsa aquí para entrar ' ||
     '(válido durante 15 minutos):</p>' ||
     '<p><a href="{{magicLinkUrl}}">{{magicLinkUrl}}</a></p>' ||
     '<p>Si no has sido tú, ignora este email — nadie ha entrado en tu cuenta.</p>',
   ARRAY['namePrefix','magicLinkUrl']
  )
ON CONFLICT (key, channel, locale) DO NOTHING;
