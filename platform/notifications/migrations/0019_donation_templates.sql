-- Plantillas para el módulo de donaciones (platform/donations).
-- Cada evento que emite el módulo se mapea a una plantilla aquí.
--
-- Variables disponibles:
--   namePrefix     — " <DonorName>" o ""
--   amountFormatted — "12,50 €"
--   causeName      — nombre de la causa o "fondo general"
--   year           — año fiscal del certificado
--   certificateUrl — URL presigned del PDF

INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, body_html, variables) VALUES
  ('donation.thank_you', 'email', 'es',
   'Gracias por tu donación',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Hemos recibido tu donación de {{amountFormatted}}. Va destinada a {{causeName}}.' || E'\n\n' ||
     'Gracias de corazón. Tu apoyo nos permite seguir adelante.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Hemos recibido tu donación de <strong>{{amountFormatted}}</strong>. Va destinada a <em>{{causeName}}</em>.</p>' ||
     '<p>Gracias de corazón. Tu apoyo nos permite seguir adelante.</p>',
   ARRAY['namePrefix','amountFormatted','causeName']
  ),
  ('donation.receipt.monthly', 'email', 'es',
   'Tu donación mensual — recibo',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Acabamos de procesar tu donación mensual de {{amountFormatted}} para {{causeName}}.' || E'\n\n' ||
     'Gracias por seguir con nosotros mes a mes.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Acabamos de procesar tu donación mensual de <strong>{{amountFormatted}}</strong> para <em>{{causeName}}</em>.</p>' ||
     '<p>Gracias por seguir con nosotros mes a mes.</p>',
   ARRAY['namePrefix','amountFormatted','causeName']
  ),
  ('donation.payment_failed', 'email', 'es',
   'No pudimos procesar tu donación mensual',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'No hemos podido cobrar tu donación mensual de {{amountFormatted}} este mes. ' ||
     'Suele deberse a una tarjeta caducada o fondos insuficientes. ' ||
     'Stripe reintentará el cobro automáticamente en los próximos días.' || E'\n\n' ||
     'Si quieres revisar el método de pago, contacta con nosotros.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>No hemos podido cobrar tu donación mensual de <strong>{{amountFormatted}}</strong> este mes. ' ||
     'Suele deberse a una tarjeta caducada o fondos insuficientes. ' ||
     'Stripe reintentará el cobro automáticamente en los próximos días.</p>' ||
     '<p>Si quieres revisar el método de pago, contacta con nosotros.</p>',
   ARRAY['namePrefix','amountFormatted']
  ),
  ('donation.cancelled', 'email', 'es',
   'Tu donación mensual ha sido cancelada',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Tu donación mensual ha sido cancelada. Gracias por todo el apoyo prestado.' || E'\n\n' ||
     'Si en algún momento quieres volver a colaborar, estaremos encantados.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Tu donación mensual ha sido cancelada. Gracias por todo el apoyo prestado.</p>' ||
     '<p>Si en algún momento quieres volver a colaborar, estaremos encantados.</p>',
   ARRAY['namePrefix']
  ),
  ('donation.refunded', 'email', 'es',
   'Tu donación ha sido reembolsada',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Hemos procesado el reembolso de tu donación de {{amountFormatted}}. ' ||
     'Debería aparecer en tu cuenta en 5-10 días laborables, según tu banco.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Hemos procesado el reembolso de tu donación de <strong>{{amountFormatted}}</strong>. ' ||
     'Debería aparecer en tu cuenta en 5-10 días laborables, según tu banco.</p>',
   ARRAY['namePrefix','amountFormatted']
  ),
  ('donation.certificate.ready', 'email', 'es',
   'Tu certificado de donativos {{year}}',
   'Hola{{namePrefix}},' || E'\n\n' ||
     'Ya está disponible tu certificado de donativos del año {{year}}. ' ||
     'Puedes descargarlo desde el siguiente enlace (válido durante 30 días):' || E'\n\n' ||
     '{{certificateUrl}}' || E'\n\n' ||
     'Te servirá para deducir tus donativos en la declaración de la Renta ' ||
     'según la Ley 49/2002.',
   '<p>Hola{{namePrefix}},</p>' ||
     '<p>Ya está disponible tu certificado de donativos del año <strong>{{year}}</strong>. ' ||
     'Puedes descargarlo desde el siguiente enlace (válido durante 30 días):</p>' ||
     '<p><a href="{{certificateUrl}}">{{certificateUrl}}</a></p>' ||
     '<p>Te servirá para deducir tus donativos en la declaración de la Renta ' ||
     'según la Ley 49/2002.</p>',
   ARRAY['namePrefix','year','certificateUrl']
  )
ON CONFLICT (key, channel, locale) DO NOTHING;
