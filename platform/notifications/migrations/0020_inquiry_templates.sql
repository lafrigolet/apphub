-- Plantillas para el módulo de inquiries (platform/inquiries).
-- 2 emails por consulta entrante:
--   1) inquiry.admin_alert  → al contact_inbox_email del tenant
--   2) inquiry.user_thank_you → al email del user que envió el form
--
-- Variables disponibles (todas las del payload `inquiry.created` event):
--   contactName, email, phone, subject, message, reference

INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, body_html, variables) VALUES
  ('inquiry.admin_alert', 'email', 'es',
   'Nueva consulta de {{contactName}} ({{reference}})',
   'Nueva consulta recibida desde el formulario de contacto.' || E'\n\n' ||
     'Nombre:    {{contactName}}' || E'\n' ||
     'Email:     {{email}}' || E'\n' ||
     'Teléfono:  {{phone}}' || E'\n' ||
     'Asunto:    {{subject}}' || E'\n\n' ||
     'Mensaje:' || E'\n' ||
     '{{message}}' || E'\n\n' ||
     '--' || E'\n' ||
     'Referencia: {{reference}}' || E'\n' ||
     'Para responder, basta con que pulses Responder — el email se enviará directamente a {{email}}.',
   '<p><strong>Nueva consulta</strong> recibida desde el formulario de contacto.</p>' ||
     '<dl>' ||
     '<dt>Nombre</dt><dd>{{contactName}}</dd>' ||
     '<dt>Email</dt><dd>{{email}}</dd>' ||
     '<dt>Teléfono</dt><dd>{{phone}}</dd>' ||
     '<dt>Asunto</dt><dd>{{subject}}</dd>' ||
     '</dl>' ||
     '<p><strong>Mensaje:</strong></p>' ||
     '<blockquote>{{message}}</blockquote>' ||
     '<hr>' ||
     '<p style="color:#666;font-size:12px">Referencia: <code>{{reference}}</code>. ' ||
     'Para responder, basta con que pulses Responder — el email se enviará directamente a {{email}}.</p>',
   ARRAY['contactName','email','phone','subject','message','reference']
  ),
  ('inquiry.user_thank_you', 'email', 'es',
   'Hemos recibido tu consulta — referencia {{reference}}',
   'Hola {{contactName}},' || E'\n\n' ||
     'Hemos recibido tu mensaje y te responderemos lo antes posible.' || E'\n\n' ||
     'Si necesitas hacer una referencia a esta consulta, cítala con: {{reference}}' || E'\n\n' ||
     'Gracias por escribirnos.',
   '<p>Hola {{contactName}},</p>' ||
     '<p>Hemos recibido tu mensaje y te responderemos lo antes posible.</p>' ||
     '<p>Si necesitas hacer una referencia a esta consulta, cítala con: <code>{{reference}}</code></p>' ||
     '<p>Gracias por escribirnos.</p>',
   ARRAY['contactName','reference']
  )
ON CONFLICT (key, channel, locale) DO UPDATE SET
  subject   = EXCLUDED.subject,
  body_text = EXCLUDED.body_text,
  body_html = EXCLUDED.body_html,
  variables = EXCLUDED.variables;
