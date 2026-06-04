-- Editable templates for the event consumers wired in this wave:
--
--   push channel:
--     review.replied              (buyer ← vendor reply)
--     dispute.opened              (buyer confirmation)
--     dispute.withdrawn           (buyer confirmation)
--     package.frozen              (client ← admin pause)
--     package.unfrozen            (client ← admin resume; {{daysAdded}})
--     package.refunded            (client ← admin cancel/refund; {{amount}})
--
--   sms channel:
--     waitlist.notified           (restaurant guest, table freed; {{namePrefix}})
--     booking.waitlist.notified   (appointment client, slot freed)
--
-- Push rows carry `subject` (notification title) + `body_text` (body); no html.
-- All rows are seeded for es + en. Hardcoded fallbacks in push/sms.service.js
-- guarantee delivery even if a row is later disabled/deleted.

INSERT INTO platform_notifications.templates (key, channel, locale, subject, body_text, variables) VALUES
  -- review.replied (push)
  ('review.replied', 'push', 'es',
   'Nueva respuesta a tu reseña',
   'El vendedor ha respondido a tu reseña.',
   ARRAY[]::text[]),
  ('review.replied', 'push', 'en',
   'New reply to your review',
   'The seller has replied to your review.',
   ARRAY[]::text[]),

  -- dispute.opened (push)
  ('dispute.opened', 'push', 'es',
   'Reclamación abierta',
   'Hemos recibido tu reclamación y nuestro equipo la revisará en breve.',
   ARRAY[]::text[]),
  ('dispute.opened', 'push', 'en',
   'Dispute opened',
   'We have received your dispute and our team will review it shortly.',
   ARRAY[]::text[]),

  -- dispute.withdrawn (push)
  ('dispute.withdrawn', 'push', 'es',
   'Reclamación retirada',
   'Tu reclamación ha sido retirada y queda cerrada.',
   ARRAY[]::text[]),
  ('dispute.withdrawn', 'push', 'en',
   'Dispute withdrawn',
   'Your dispute has been withdrawn and is now closed.',
   ARRAY[]::text[]),

  -- package.frozen (push)
  ('package.frozen', 'push', 'es',
   'Tu bono se ha congelado',
   'Tu bono se ha congelado. Su caducidad queda en pausa hasta que se reactive.',
   ARRAY[]::text[]),
  ('package.frozen', 'push', 'en',
   'Your package has been paused',
   'Your package has been paused. Its expiry is on hold until it is resumed.',
   ARRAY[]::text[]),

  -- package.unfrozen (push)
  ('package.unfrozen', 'push', 'es',
   'Tu bono vuelve a estar activo',
   'Tu bono vuelve a estar activo. Hemos añadido {{daysAdded}} día(s) a su caducidad.',
   ARRAY['daysAdded']),
  ('package.unfrozen', 'push', 'en',
   'Your package is active again',
   'Your package is active again. We added {{daysAdded}} day(s) to its expiry.',
   ARRAY['daysAdded']),

  -- package.refunded (push)
  ('package.refunded', 'push', 'es',
   'Bono reembolsado',
   'Tu bono ha sido reembolsado ({{amount}}). Puede tardar varios días en reflejarse en tu cuenta.',
   ARRAY['amount']),
  ('package.refunded', 'push', 'en',
   'Package refunded',
   'Your package has been refunded ({{amount}}). It can take several days to appear on your statement.',
   ARRAY['amount']),

  -- waitlist.notified (sms — restaurant)
  ('waitlist.notified', 'sms', 'es',
   NULL,
   'Hola{{namePrefix}}, se ha quedado una mesa libre. Contáctanos pronto para confirmarla antes de que se ofrezca al siguiente.',
   ARRAY['namePrefix']),
  ('waitlist.notified', 'sms', 'en',
   NULL,
   'Hi{{namePrefix}}, a table just opened up. Reply or call us soon to claim it before it''s offered to the next party.',
   ARRAY['namePrefix']),

  -- booking.waitlist.notified (sms — appointments)
  ('booking.waitlist.notified', 'sms', 'es',
   NULL,
   'Se ha liberado un hueco para el servicio en el que estabas en lista de espera. Resérvalo pronto antes de que se ofrezca al siguiente.',
   ARRAY[]::text[]),
  ('booking.waitlist.notified', 'sms', 'en',
   NULL,
   'A slot just opened up for the service you were waiting for. Book it soon before it is offered to the next person.',
   ARRAY[]::text[])
ON CONFLICT (key, channel, locale) DO NOTHING;
