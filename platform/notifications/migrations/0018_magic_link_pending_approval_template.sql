-- Magic-link request hecha por un user en pending_approval. En lugar de
-- silencio (que deja al user sin feedback), enviamos un email que le
-- recuerda que su solicitud está pendiente del admin.
--
-- Seguro contra enumeration: el response HTTP del endpoint sigue siendo
-- 200 "si ese email existe…" igual que en cualquier otro caso, así que un
-- atacante no puede deducir nada. El email sólo llega al dueño legítimo
-- de la cuenta.

INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, body_html, variables) VALUES
  ('auth.magic_link_blocked_pending_approval', 'email', 'es',
   'Tu solicitud sigue pendiente de aprobación',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Has solicitado un enlace de acceso, pero tu solicitud de alta aún está ' ||
     'pendiente de aprobación por un administrador. Cuando se apruebe te ' ||
     'avisaremos por email y podrás entrar normalmente.' || E'\n\n' ||
     'No tienes que hacer nada más por ahora.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Has solicitado un enlace de acceso, pero tu solicitud de alta aún está ' ||
     'pendiente de aprobación por un administrador. Cuando se apruebe te ' ||
     'avisaremos por email y podrás entrar normalmente.</p>' ||
     '<p>No tienes que hacer nada más por ahora.</p>',
   ARRAY['namePrefix']
  )
ON CONFLICT (key, channel, locale) DO NOTHING;
