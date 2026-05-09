-- Plantillas del flujo Bootstrap: magic-link de activación y bienvenida
-- post-activación. El email service tiene defaults hard-coded por si la
-- fila no existe; staff los puede personalizar luego desde voragine-console.

INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, body_html, variables) VALUES
  ('tenant.bootstrap_started', 'email', 'es',
   'Bienvenido a {{appLabel}} — activa tu cuenta',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Tu cuenta de {{tenantLabel}} en {{appLabel}} ya está lista. ' ||
     'Pulsa el enlace para fijar tu contraseña y empezar a usarla (válido hasta {{expiresStr}}):' || E'\n\n' ||
     '{{magicLinkUrl}}' || E'\n\n' ||
     'Si no esperabas este email, puedes ignorarlo.',
   '<p>Hola{{namePrefix}},</p><p>Tu cuenta de <strong>{{tenantLabel}}</strong> en <strong>{{appLabel}}</strong> ya está lista. Pulsa el enlace para fijar tu contraseña y empezar a usarla (válido hasta {{expiresStr}}):</p><p><a href="{{magicLinkUrl}}">{{magicLinkUrl}}</a></p><p>Si no esperabas este email, puedes ignorarlo.</p>',
   ARRAY['namePrefix','tenantLabel','appLabel','expiresStr','magicLinkUrl']
  ),
  ('tenant.bootstrap_started', 'email', 'en',
   'Welcome to {{appLabel}} — activate your account',
   'Hi{{namePrefix}},' || E'\n\n' ||
     'Your account for {{tenantLabel}} on {{appLabel}} is ready. ' ||
     'Click the link below to set a password and start using it (valid until {{expiresStr}}):' || E'\n\n' ||
     '{{magicLinkUrl}}' || E'\n\n' ||
     'If you didn''t expect this email, you can ignore it.',
   '<p>Hi{{namePrefix}},</p><p>Your account for <strong>{{tenantLabel}}</strong> on <strong>{{appLabel}}</strong> is ready. Click the link below to set a password and start using it (valid until {{expiresStr}}):</p><p><a href="{{magicLinkUrl}}">{{magicLinkUrl}}</a></p><p>If you didn''t expect this email, you can ignore it.</p>',
   ARRAY['namePrefix','tenantLabel','appLabel','expiresStr','magicLinkUrl']
  ),
  ('tenant.activated', 'email', 'es',
   'Tu cuenta está activa — termina la configuración',
   '¡Bienvenido! Tu cuenta está activa. Entra al panel para terminar de configurar tu espacio e invitar a tu equipo.',
   '<p>¡Bienvenido!</p><p>Tu cuenta está activa. Entra al panel para terminar de configurar tu espacio e invitar a tu equipo.</p>',
   ARRAY[]::text[]
  ),
  ('tenant.activated', 'email', 'en',
   'Your account is active — set up your workspace',
   'Welcome! Your account is now active. Open the dashboard to finish configuring your workspace and invite your team.',
   '<p>Welcome!</p><p>Your account is now active. Open the dashboard to finish configuring your workspace and invite your team.</p>',
   ARRAY[]::text[]
  )
ON CONFLICT (key, channel, locale) DO NOTHING;
